import { describe, it, expect, vi } from 'vitest'
import {
  buildUrl,
  fetchEthTransactions,
  fetchTokenTransactions,
  EtherscanError,
  chainLabel,
  explorerTxUrl,
  explorerAddressUrl,
} from './etherscan'

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function client(fetchImpl: typeof fetch, chainId = 1) {
  return { apiKey: 'REAL_KEY', chainId, fetchImpl }
}

describe('buildUrl', () => {
  it('targets the v2 host with a chainid parameter', () => {
    // v1 (api.etherscan.io/api?module=…) is deprecated and now answers every
    // request with NOTOK, which is why the old history was permanently empty.
    const url = new URL(buildUrl(1, { module: 'account', action: 'txlist' }))
    expect(url.origin + url.pathname).toBe('https://api.etherscan.io/v2/api')
    expect(url.searchParams.get('chainid')).toBe('1')
    expect(url.searchParams.get('module')).toBe('account')
  })

  it('uses one host for every chain rather than a per-network subdomain', () => {
    const url = new URL(buildUrl(11155111, {}))
    expect(url.hostname).toBe('api.etherscan.io')
    expect(url.searchParams.get('chainid')).toBe('11155111')
  })
})

describe('fetchEthTransactions', () => {
  it('requests txlist and returns the rows', async () => {
    const rows = [{ hash: '0x1' }]
    const fetchImpl = vi.fn().mockResolvedValue(response({ status: '1', result: rows }))

    expect(await fetchEthTransactions(client(fetchImpl), ADDRESS, 25)).toEqual(rows)

    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.searchParams.get('action')).toBe('txlist')
    expect(url.searchParams.get('address')).toBe(ADDRESS)
    expect(url.searchParams.get('offset')).toBe('25')
    expect(url.searchParams.get('sort')).toBe('desc')
    expect(url.searchParams.get('apikey')).toBe('REAL_KEY')
  })
})

describe('fetchTokenTransactions', () => {
  it('requests tokentx scoped to the contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ status: '1', result: [] }))
    await fetchTokenTransactions(client(fetchImpl), ADDRESS, TOKEN, 50)

    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.searchParams.get('action')).toBe('tokentx')
    expect(url.searchParams.get('contractaddress')).toBe(TOKEN)
    expect(url.searchParams.get('offset')).toBe('50')
  })
})

describe('error handling', () => {
  it('treats "no transactions found" as an empty list, not a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ status: '0', message: 'No transactions found', result: [] }),
    )
    expect(await fetchEthTransactions(client(fetchImpl), ADDRESS)).toEqual([])
  })

  it('raises a config error for a rejected key rather than returning empty', async () => {
    // Returning [] for a bad key is what hid the outage: an empty history looked
    // like a quiet wallet.
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ status: '0', message: 'NOTOK', result: 'Invalid API Key' }),
    )
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toMatchObject({
      name: 'EtherscanError',
      kind: 'config',
    })
  })

  it('names the v1 deprecation explicitly if it is ever hit again', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        status: '0',
        message: 'NOTOK',
        result: 'You are using a deprecated V1 endpoint, switch to Etherscan API V2',
      }),
    )
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toThrow(/v1 endpoint/i)
  })

  it('flags rate limiting from the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' }),
    )
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toMatchObject({
      kind: 'rate-limit',
    })
  })

  it('flags rate limiting from the status code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 429))
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toMatchObject({
      kind: 'rate-limit',
    })
  })

  it('reports an upstream failure for a 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 503))
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toMatchObject({
      kind: 'upstream',
    })
  })

  it('reports a network failure when fetch itself rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('reports an upstream failure for a non-JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toMatchObject({
      kind: 'upstream',
    })
  })

  it.each([['missing', ''], ['placeholder', 'your-api-key']])(
    'refuses a %s API key without making a request',
    async (_label, apiKey) => {
      const fetchImpl = vi.fn()
      await expect(
        fetchEthTransactions({ apiKey, chainId: 1, fetchImpl }, ADDRESS),
      ).rejects.toMatchObject({ kind: 'config' })
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it('is an EtherscanError instance so callers can branch on kind', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 503))
    await expect(fetchEthTransactions(client(fetchImpl), ADDRESS)).rejects.toBeInstanceOf(
      EtherscanError,
    )
  })
})

describe('chain metadata', () => {
  it('labels known chains', () => {
    expect(chainLabel(1)).toBe('Ethereum')
    expect(chainLabel(11155111)).toBe('Sepolia')
    expect(chainLabel(8453)).toBe('Base')
  })

  it('falls back to the id for an unknown chain', () => {
    expect(chainLabel(999999)).toBe('Chain 999999')
  })

  it('builds explorer links per chain', () => {
    expect(explorerTxUrl(1, '0xabc')).toBe('https://etherscan.io/tx/0xabc')
    expect(explorerTxUrl(11155111, '0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc')
    expect(explorerAddressUrl(8453, ADDRESS)).toBe(`https://basescan.org/address/${ADDRESS}`)
  })

  it('falls back to mainnet links for an unknown chain', () => {
    expect(explorerTxUrl(999999, '0xabc')).toBe('https://etherscan.io/tx/0xabc')
  })
})
