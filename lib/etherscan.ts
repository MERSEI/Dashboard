/**
 * Etherscan API v2 client.
 *
 * The previous implementation called the v1 endpoints
 * (`https://api.etherscan.io/api?module=…`) and a per-network host
 * (`api-goerli.etherscan.io`). Both are gone: v1 now answers every request with
 * `{"status":"0","message":"NOTOK","result":"You are using a deprecated V1
 * endpoint…"}` and the Goerli host no longer resolves at all. Because
 * `getTransactionHistory` swallowed failures into `return []`, the dashboard
 * silently showed an empty history and a fabricated chart instead of an error.
 *
 * v2 is one host for every chain, selected by `chainid`.
 */

const BASE = 'https://api.etherscan.io/v2/api'
const DEFAULT_TIMEOUT_MS = 10_000

export type RawTx = {
  hash?: string
  from?: string
  /** null for contract-creation transactions */
  to?: string | null
  value?: string
  timeStamp?: string
  tokenDecimal?: string
  tokenSymbol?: string
  isError?: string
}

export class EtherscanError extends Error {
  readonly kind: 'config' | 'rate-limit' | 'upstream' | 'network'
  constructor(kind: EtherscanError['kind'], message: string) {
    super(message)
    this.name = 'EtherscanError'
    this.kind = kind
  }
}

export type EtherscanClientOptions = {
  apiKey: string
  chainId: number
  /** Injected in tests. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Build a v2 request URL. Exported so the shape is testable without a network. */
export function buildUrl(
  chainId: number,
  params: Record<string, string | number>,
): string {
  const url = new URL(BASE)
  url.searchParams.set('chainid', String(chainId))
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v))
  }
  return url.toString()
}

type Envelope = { status?: string; message?: string; result?: unknown }

async function call(
  { apiKey, chainId, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: EtherscanClientOptions,
  params: Record<string, string | number>,
): Promise<RawTx[]> {
  if (!apiKey || apiKey.includes('your')) {
    throw new EtherscanError('config', 'ETHERSCAN_API_KEY is not configured')
  }

  const url = buildUrl(chainId, { ...params, apikey: apiKey })

  let res: Response
  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined
    res = await fetchImpl(url, { signal })
  } catch (e) {
    throw new EtherscanError('network', `Etherscan request failed: ${(e as Error).message}`)
  }

  if (res.status === 429) {
    throw new EtherscanError('rate-limit', 'Etherscan rate limit reached')
  }
  if (!res.ok) {
    throw new EtherscanError('upstream', `Etherscan returned ${res.status}`)
  }

  let body: Envelope
  try {
    body = (await res.json()) as Envelope
  } catch {
    throw new EtherscanError('upstream', 'Etherscan returned a malformed response')
  }

  // status "1" = results; "0" = either "no transactions found" (not an error) or a
  // real failure. The two are only distinguishable by the message, so a genuine
  // failure must not be flattened into an empty list.
  if (body.status === '1' && Array.isArray(body.result)) {
    return body.result as RawTx[]
  }

  const message = String(body.message ?? '')
  const detail = typeof body.result === 'string' ? body.result : ''

  if (/no transactions found|no records found/i.test(message + detail)) {
    return []
  }
  if (/rate limit|max .*rate/i.test(message + detail)) {
    throw new EtherscanError('rate-limit', 'Etherscan rate limit reached')
  }
  if (/invalid api key|missing.*api key/i.test(message + detail)) {
    throw new EtherscanError('config', 'Etherscan rejected the API key')
  }
  if (/deprecated v1 endpoint/i.test(detail)) {
    throw new EtherscanError('config', 'Etherscan v1 endpoint is deprecated; v2 is required')
  }

  throw new EtherscanError('upstream', detail || message || 'Etherscan request failed')
}

/** Native-currency transactions for an address, newest first. */
export function fetchEthTransactions(
  options: EtherscanClientOptions,
  address: string,
  limit = 25,
): Promise<RawTx[]> {
  return call(options, {
    module: 'account',
    action: 'txlist',
    address,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: limit,
    sort: 'desc',
  })
}

/** ERC-20 transfers of one contract for an address, newest first. */
export function fetchTokenTransactions(
  options: EtherscanClientOptions,
  address: string,
  contractAddress: string,
  limit = 50,
): Promise<RawTx[]> {
  return call(options, {
    module: 'account',
    action: 'tokentx',
    address,
    contractaddress: contractAddress,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: limit,
    sort: 'desc',
  })
}

/** Chains this dashboard knows how to label. */
export const CHAINS: Record<number, { name: string; explorer: string }> = {
  1: { name: 'Ethereum', explorer: 'https://etherscan.io' },
  11155111: { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io' },
  8453: { name: 'Base', explorer: 'https://basescan.org' },
  42161: { name: 'Arbitrum One', explorer: 'https://arbiscan.io' },
  10: { name: 'Optimism', explorer: 'https://optimistic.etherscan.io' },
  137: { name: 'Polygon', explorer: 'https://polygonscan.com' },
}

export function chainLabel(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`
}

export function explorerTxUrl(chainId: number, hash: string): string {
  const base = CHAINS[chainId]?.explorer ?? CHAINS[1].explorer
  return `${base}/tx/${hash}`
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const base = CHAINS[chainId]?.explorer ?? CHAINS[1].explorer
  return `${base}/address/${address}`
}
