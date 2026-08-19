'use server'

/**
 * Server Actions.
 *
 * SECURITY NOTE, because it governs everything below: each exported function here
 * is a public HTTP endpoint. Next.js compiles a Server Action into a POST route
 * addressed by an id that ships in the client bundle, so any caller can invoke any
 * exported action with arguments of their choosing. The UI is not an access
 * control boundary.
 *
 * Therefore:
 *   - every write action calls requireSession() before touching a key;
 *   - every write action is rate limited per client;
 *   - withdrawals may only target an address on the configured allowlist;
 *   - read actions are rate limited too, to protect the upstream API keys.
 */

import { cookies, headers } from 'next/headers'
import { ethers } from 'ethers'
import { readConfig, isProduction } from '@/lib/config'
import {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  readAuthConfig,
  safeEqual,
  sessionCookieOptions,
} from '@/lib/auth'
import { rateLimit, resetRateLimit, clientKey, LIMITS } from '@/lib/ratelimit'
import { logger, PublicError, publicErrorMessage } from '@/lib/logger'
import { isValidAddress, normalizeAddress, isSameAddress } from '@/lib/address'
import { toBaseUnits, fromBaseUnits, AmountError } from '@/lib/money'
import {
  fetchEthTransactions,
  fetchTokenTransactions,
  EtherscanError,
} from '@/lib/etherscan'
import {
  normalizeTransfer,
  sortTransfers,
  computeFlows,
  computePerformance,
  buildBalanceSeries,
  type Transfer,
  type Period,
} from '@/lib/portfolio'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

// ─── Session ─────────────────────────────────────────────────────────────────

export type LoginResult = { ok: true } | { ok: false; error: string; retryAfterMs?: number }

/**
 * Exchange the dashboard password for a session cookie.
 *
 * Rate limited per client so the endpoint cannot be used to guess the password,
 * and the comparison is constant-time so it cannot be used as an oracle.
 */
export async function login(password: string): Promise<LoginResult> {
  const key = `login:${clientKey(headers())}`
  const limit = rateLimit(key, LIMITS.login.limit, LIMITS.login.windowMs)
  if (!limit.allowed) {
    logger.warn('Login rate limit exceeded')
    return {
      ok: false,
      error: 'Too many attempts. Try again later.',
      retryAfterMs: limit.resetAt - Date.now(),
    }
  }

  const auth = readAuthConfig()
  if (!auth.ok) {
    logger.error('Auth is not configured', new Error(auth.reason))
    return { ok: false, error: 'Authentication is not configured on the server.' }
  }

  if (typeof password !== 'string' || !safeEqual(password, auth.password)) {
    logger.warn('Failed login attempt')
    return { ok: false, error: 'Incorrect password.' }
  }

  cookies().set(
    SESSION_COOKIE,
    createSessionToken(auth.secret),
    sessionCookieOptions(isProduction()),
  )
  resetRateLimit(key)
  logger.info('Login succeeded')
  return { ok: true }
}

export async function logout(): Promise<void> {
  cookies().delete(SESSION_COOKIE)
}

/** Whether the current request carries a valid session. Safe to call from a page. */
export async function isAuthenticated(): Promise<boolean> {
  const auth = readAuthConfig()
  if (!auth.ok) return false
  return verifySessionToken(cookies().get(SESSION_COOKIE)?.value, auth.secret).valid
}

/** Throws unless the caller holds a valid session. */
function requireSession(): void {
  const auth = readAuthConfig()
  if (!auth.ok) {
    throw new PublicError('Authentication is not configured on the server.')
  }
  const result = verifySessionToken(cookies().get(SESSION_COOKIE)?.value, auth.secret)
  if (!result.valid) {
    logger.warn('Rejected unauthenticated write action', { reason: result.reason })
    throw new PublicError(
      result.reason === 'expired' ? 'Your session expired. Sign in again.' : 'Not authorised.',
    )
  }
}

/** Applies the transfer budget, keyed per client. */
function requireTransferBudget(): void {
  const limit = rateLimit(
    `transfer:${clientKey(headers())}`,
    LIMITS.transfer.limit,
    LIMITS.transfer.windowMs,
  )
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 60000))
    throw new PublicError(`Transfer limit reached. Try again in ${minutes} min.`)
  }
}

// ─── Read path ───────────────────────────────────────────────────────────────

export type TokenMeta = { symbol: string; decimals: number }

export type DashboardData = {
  address: string
  chainId: number
  token: TokenMeta
  /** Token balance, human-readable. */
  tokenBalance: string
  /** Native balance, human-readable. */
  nativeBalance: string
  transfers: Transfer[]
  flows: ReturnType<typeof computeFlows>
  performance: ReturnType<typeof computePerformance>
  series: ReturnType<typeof buildBalanceSeries>
  /** Non-fatal problems worth showing rather than hiding. */
  warnings: string[]
}

async function readTokenAndBalances(
  rpcUrl: string,
  tokenAddress: string,
  address: string,
): Promise<{ token: TokenMeta; tokenBalance: string; nativeBalance: string }> {
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)

  const [nativeRaw, balanceRaw, decimalsRaw, symbolRaw] = await Promise.all([
    provider.getBalance(address),
    contract.balanceOf(address),
    contract.decimals(),
    contract.symbol(),
  ])

  const decimals = Number(decimalsRaw)
  return {
    token: { symbol: String(symbolRaw), decimals },
    tokenBalance: fromBaseUnits(balanceRaw, decimals),
    nativeBalance: ethers.formatEther(nativeRaw),
  }
}

/**
 * Everything the dashboard renders, for any address.
 *
 * A failure to read the chain is fatal (there is nothing to show); a failure to
 * read history is reported as a warning, because the balance is still true and
 * worth displaying. What never happens is substituting invented data.
 */
export async function getDashboardData(
  addressInput?: string,
  period: Period = '1M',
): Promise<DashboardData> {
  const limit = rateLimit(`read:${clientKey(headers())}`, LIMITS.read.limit, LIMITS.read.windowMs)
  if (!limit.allowed) throw new PublicError('Too many requests. Slow down for a moment.')

  const cfg = readConfig()
  if (!cfg.ok) {
    throw new PublicError(
      `Server is not configured: ${[...cfg.missing, ...cfg.invalid].join(', ')}`,
    )
  }
  const { config } = cfg

  const address = normalizeAddress(addressInput ?? config.watchAddress)
  if (!address) throw new PublicError('That is not a valid Ethereum address.')

  const warnings: string[] = []

  let chain: Awaited<ReturnType<typeof readTokenAndBalances>>
  try {
    chain = await readTokenAndBalances(config.rpcUrl, config.tokenAddress, address)
  } catch (error) {
    logger.error('Chain read failed', error)
    throw new PublicError('Could not reach the network. Check the RPC endpoint and try again.')
  }

  let transfers: Transfer[] = []
  try {
    const options = { apiKey: config.etherscanApiKey, chainId: config.chainId }
    const [nativeRaw, tokenRaw] = await Promise.all([
      fetchEthTransactions(options, address),
      fetchTokenTransactions(options, address, config.tokenAddress),
    ])

    transfers = sortTransfers(
      [
        ...nativeRaw.map(r => normalizeTransfer(r, address, 'NATIVE', 18, 'ETH')),
        ...tokenRaw.map(r =>
          normalizeTransfer(r, address, 'TOKEN', chain.token.decimals, chain.token.symbol),
        ),
      ].filter((t): t is Transfer => t !== null),
    )
  } catch (error) {
    logger.error('History read failed', error)
    warnings.push(
      error instanceof EtherscanError && error.kind === 'config'
        ? 'Transaction history is unavailable: the Etherscan API key is missing or rejected.'
        : 'Transaction history is temporarily unavailable. Balances below are still live.',
    )
  }

  const balanceNumber = Number(chain.tokenBalance)
  const flows = computeFlows(transfers, 'TOKEN')
  const performance = computePerformance(balanceNumber, flows)
  const series = buildBalanceSeries(transfers, balanceNumber, period)

  return {
    address,
    chainId: config.chainId,
    token: chain.token,
    tokenBalance: chain.tokenBalance,
    nativeBalance: chain.nativeBalance,
    transfers,
    flows,
    performance,
    series,
    warnings,
  }
}

/** Recompute only the balance series, for the period switcher. */
export async function getSeries(
  addressInput: string,
  period: Period,
): Promise<ReturnType<typeof buildBalanceSeries>> {
  const data = await getDashboardData(addressInput, period)
  return data.series
}

// ─── Write path ──────────────────────────────────────────────────────────────

export type TransferResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string }

type SignerBundle = {
  wallet: ethers.Wallet
  contract: ethers.Contract
  decimals: number
  symbol: string
}

async function getSigner(): Promise<SignerBundle> {
  const cfg = readConfig()
  if (!cfg.ok) throw new PublicError('Server is not configured.')

  const privateKey = process.env.WALLET_PRIVATE_KEY
  if (!privateKey || privateKey.includes('your')) {
    throw new PublicError('Transfers are disabled: no signing key is configured.')
  }

  const provider = new ethers.JsonRpcProvider(cfg.config.rpcUrl)
  const wallet = new ethers.Wallet(privateKey, provider)
  const contract = new ethers.Contract(cfg.config.tokenAddress, ERC20_ABI, wallet)

  // Decimals come from the contract, never from a constant: hardcoding 6 against
  // an 18-decimal token scales every transfer by a factor of a trillion.
  const [decimalsRaw, symbolRaw] = await Promise.all([contract.decimals(), contract.symbol()])

  return {
    wallet,
    contract,
    decimals: Number(decimalsRaw),
    symbol: String(symbolRaw),
  }
}

async function submitTransfer(
  bundle: SignerBundle,
  to: string,
  amount: string,
): Promise<TransferResult> {
  const units = toBaseUnits(amount, bundle.decimals)

  const balance: bigint = await bundle.contract.balanceOf(bundle.wallet.address)
  if (balance < units) {
    return {
      ok: false,
      error: `Insufficient balance: ${fromBaseUnits(balance, bundle.decimals)} ${bundle.symbol} available.`,
    }
  }

  const tx = await bundle.contract.transfer(to, units)
  logger.info('Transfer submitted', { hash: tx.hash })

  const receipt = await tx.wait(1)
  if (!receipt || receipt.status !== 1) {
    return { ok: false, error: 'The transaction was reverted on-chain.' }
  }

  return { ok: true, txHash: tx.hash }
}

/**
 * Move tokens from the signing wallet into the watched address.
 * Requires a session; rate limited.
 */
export async function depositFunds(amount: string): Promise<TransferResult> {
  try {
    requireSession()
    requireTransferBudget()

    const cfg = readConfig()
    if (!cfg.ok) throw new PublicError('Server is not configured.')

    const bundle = await getSigner()
    return await submitTransfer(bundle, cfg.config.watchAddress, amount)
  } catch (error) {
    if (error instanceof AmountError) return { ok: false, error: error.message }
    logger.error('Deposit failed', error)
    return { ok: false, error: publicErrorMessage(error, 'The transfer could not be completed.') }
  }
}

/**
 * Move tokens from the signing wallet to an external address.
 *
 * Requires a session, is rate limited, and — the control that actually bounds the
 * damage — refuses any destination that is not on WITHDRAW_ALLOWLIST. An empty
 * allowlist disables withdrawals entirely rather than allowing everything.
 */
export async function withdrawFunds(toAddress: string, amount: string): Promise<TransferResult> {
  try {
    requireSession()
    requireTransferBudget()

    const cfg = readConfig()
    if (!cfg.ok) throw new PublicError('Server is not configured.')

    if (!isValidAddress(toAddress)) {
      return { ok: false, error: 'That is not a valid Ethereum address.' }
    }
    const to = normalizeAddress(toAddress) as string

    const allowlist = cfg.config.withdrawAllowlist
    if (allowlist.length === 0) {
      return {
        ok: false,
        error: 'Withdrawals are disabled: WITHDRAW_ALLOWLIST is empty.',
      }
    }
    if (!allowlist.some(entry => isSameAddress(entry, to))) {
      logger.warn('Withdrawal to a non-allowlisted address refused')
      return {
        ok: false,
        error: 'That address is not on the withdrawal allowlist.',
      }
    }

    const bundle = await getSigner()
    if (isSameAddress(to, bundle.wallet.address)) {
      return { ok: false, error: 'That is the signing wallet — the transfer would be a no-op.' }
    }

    return await submitTransfer(bundle, to, amount)
  } catch (error) {
    if (error instanceof AmountError) return { ok: false, error: error.message }
    logger.error('Withdrawal failed', error)
    return { ok: false, error: publicErrorMessage(error, 'The transfer could not be completed.') }
  }
}

/** What the UI needs to know about the write path without exposing configuration. */
export async function getTransferCapability(): Promise<{
  authenticated: boolean
  signingConfigured: boolean
  withdrawalTargets: string[]
}> {
  const cfg = readConfig()
  return {
    authenticated: await isAuthenticated(),
    signingConfigured: cfg.ok ? cfg.config.hasPrivateKey : false,
    withdrawalTargets: cfg.ok ? cfg.config.withdrawAllowlist : [],
  }
}
