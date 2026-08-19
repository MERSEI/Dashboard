/**
 * Environment configuration.
 *
 * Read lazily and reported as data, never thrown at module scope: a `throw` in a
 * module body during a Next.js build takes down the whole route, and the previous
 * page turned a missing variable into a 500-shaped "Configuration Error" page that
 * was then *statically prerendered* — so fixing the variable did not fix the page.
 */

import { normalizeAddress, parseAddressList } from './address'

/** Anything shaped like an environment: process.env, or a plain object in tests. */
export type EnvLike = Record<string, string | undefined>

export type Config = {
  rpcUrl: string
  chainId: number
  tokenAddress: string
  etherscanApiKey: string
  /** The address the dashboard reports on. */
  watchAddress: string
  /** Withdrawals may only go to these addresses. Empty = withdrawals disabled. */
  withdrawAllowlist: string[]
  /** Present only when the write actions are configured. */
  hasPrivateKey: boolean
}

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; missing: string[]; invalid: string[] }

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('your')
}

/**
 * Read and validate configuration for the read-only dashboard.
 * Write-action configuration is validated separately, at the point of use.
 */
export function readConfig(env: EnvLike = process.env): ConfigResult {
  const missing: string[] = []
  const invalid: string[] = []

  if (!present(env.RPC_URL)) missing.push('RPC_URL')
  if (!present(env.ETHERSCAN_API_KEY)) missing.push('ETHERSCAN_API_KEY')
  if (!present(env.TOKEN_CONTRACT_ADDRESS)) missing.push('TOKEN_CONTRACT_ADDRESS')
  if (!present(env.NEXT_PUBLIC_WALLET_ADDRESS)) missing.push('NEXT_PUBLIC_WALLET_ADDRESS')

  const token = normalizeAddress(env.TOKEN_CONTRACT_ADDRESS)
  if (present(env.TOKEN_CONTRACT_ADDRESS) && !token) invalid.push('TOKEN_CONTRACT_ADDRESS')

  const watch = normalizeAddress(env.NEXT_PUBLIC_WALLET_ADDRESS)
  if (present(env.NEXT_PUBLIC_WALLET_ADDRESS) && !watch) invalid.push('NEXT_PUBLIC_WALLET_ADDRESS')

  const chainId = Number(env.NEXT_PUBLIC_CHAIN_ID ?? '1')
  if (!Number.isInteger(chainId) || chainId <= 0) invalid.push('NEXT_PUBLIC_CHAIN_ID')

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, missing, invalid }
  }

  return {
    ok: true,
    config: {
      rpcUrl: env.RPC_URL as string,
      chainId,
      tokenAddress: token as string,
      etherscanApiKey: env.ETHERSCAN_API_KEY as string,
      watchAddress: watch as string,
      withdrawAllowlist: parseAddressList(env.WITHDRAW_ALLOWLIST),
      hasPrivateKey: present(env.WALLET_PRIVATE_KEY),
    },
  }
}

export function isProduction(env: EnvLike = process.env): boolean {
  return env.NODE_ENV === 'production'
}
