import { describe, it, expect } from 'vitest'
import {
  normalizeTransfer,
  sortTransfers,
  computeFlows,
  computePerformance,
  buildBalanceSeries,
  periodWindow,
  seriesChange,
  type Transfer,
} from './portfolio'
import type { RawTx } from './etherscan'

const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const PEER = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'

function raw(over: Partial<RawTx> = {}): RawTx {
  return {
    hash: '0xabc',
    from: PEER,
    to: OWNER,
    value: '1000000',
    timeStamp: '1700000000',
    tokenDecimal: '6',
    tokenSymbol: 'USDC',
    ...over,
  }
}

function transfer(over: Partial<Transfer> = {}): Transfer {
  return {
    hash: '0x1',
    from: PEER,
    to: OWNER,
    amount: '100',
    timestamp: 1_700_000_000_000,
    direction: 'in',
    asset: 'TOKEN',
    symbol: 'USDC',
    failed: false,
    ...over,
  }
}

describe('normalizeTransfer', () => {
  it('maps a token transfer using the decimals from the row', () => {
    const t = normalizeTransfer(raw(), OWNER, 'TOKEN', 6, 'USDC')!
    expect(t).toMatchObject({
      hash: '0xabc',
      amount: '1.0',
      direction: 'in',
      asset: 'TOKEN',
      symbol: 'USDC',
      failed: false,
      timestamp: 1_700_000_000_000,
    })
  })

  it('prefers the row decimals over the fallback', () => {
    const t = normalizeTransfer(raw({ tokenDecimal: '18', value: '1000000000000000000' }), OWNER, 'TOKEN', 6, 'USDC')!
    expect(t.amount).toBe('1.0')
  })

  it('falls back when the row omits decimals', () => {
    const t = normalizeTransfer(raw({ tokenDecimal: undefined }), OWNER, 'TOKEN', 6, 'USDC')!
    expect(t.amount).toBe('1.0')
  })

  it('always uses 18 decimals for the native asset', () => {
    const t = normalizeTransfer(
      raw({ value: '1000000000000000000', tokenDecimal: '6' }),
      OWNER,
      'NATIVE',
      6,
      'ETH',
    )!
    expect(t.amount).toBe('1.0')
    expect(t.symbol).toBe('ETH')
  })

  it('marks a transfer away from the owner as outgoing', () => {
    const t = normalizeTransfer(raw({ from: OWNER, to: PEER }), OWNER, 'TOKEN', 6, 'USDC')!
    expect(t.direction).toBe('out')
  })

  it('survives a null `to` (contract creation) instead of throwing', () => {
    // The old code called tx.to.toLowerCase() unconditionally, which threw and
    // took down the entire history render.
    const t = normalizeTransfer(raw({ to: null }), OWNER, 'NATIVE', 18, 'ETH')!
    expect(t.to).toBeNull()
    expect(t.direction).toBe('out')
  })

  it('flags a reverted transaction', () => {
    expect(normalizeTransfer(raw({ isError: '1' }), OWNER, 'TOKEN', 6, 'USDC')!.failed).toBe(true)
  })

  it('returns null when there is no hash to identify the row', () => {
    expect(normalizeTransfer(raw({ hash: undefined }), OWNER, 'TOKEN', 6, 'USDC')).toBeNull()
  })

  it('degrades to zero on an unparseable value', () => {
    expect(normalizeTransfer(raw({ value: 'oops' }), OWNER, 'TOKEN', 6, 'USDC')!.amount).toBe('0')
  })

  it('degrades to zero on a missing timestamp', () => {
    expect(normalizeTransfer(raw({ timeStamp: undefined }), OWNER, 'TOKEN', 6, 'USDC')!.timestamp).toBe(0)
  })
})

describe('sortTransfers', () => {
  it('orders newest first without mutating the input', () => {
    const input = [
      transfer({ hash: '0xold', timestamp: 1000 }),
      transfer({ hash: '0xnew', timestamp: 3000 }),
    ]
    const sorted = sortTransfers(input)
    expect(sorted.map(t => t.hash)).toEqual(['0xnew', '0xold'])
    expect(input[0].hash).toBe('0xold')
  })
})

describe('computeFlows', () => {
  it('sums incoming and outgoing separately', () => {
    const flows = computeFlows([
      transfer({ amount: '100', direction: 'in' }),
      transfer({ amount: '30', direction: 'out' }),
    ])
    expect(flows).toEqual({ in: 100, out: 30, net: 70, count: 2 })
  })

  it('excludes reverted transactions', () => {
    // They appear in history but moved nothing; counting them corrupts every
    // figure derived from the totals.
    const flows = computeFlows([
      transfer({ amount: '100', direction: 'in' }),
      transfer({ amount: '999', direction: 'in', failed: true }),
    ])
    expect(flows).toEqual({ in: 100, out: 0, net: 100, count: 1 })
  })

  it('only counts the asset asked for', () => {
    const flows = computeFlows([
      transfer({ amount: '100', asset: 'TOKEN' }),
      transfer({ amount: '5', asset: 'NATIVE' }),
    ])
    expect(flows.count).toBe(1)
    expect(flows.in).toBe(100)
  })

  it('can total the native asset instead', () => {
    const flows = computeFlows(
      [transfer({ amount: '2', asset: 'NATIVE' }), transfer({ amount: '100', asset: 'TOKEN' })],
      'NATIVE',
    )
    expect(flows.in).toBe(2)
  })

  it('ignores unparseable amounts', () => {
    expect(computeFlows([transfer({ amount: 'nonsense' })]).count).toBe(0)
  })

  it('returns zeroes for an empty list', () => {
    expect(computeFlows([])).toEqual({ in: 0, out: 0, net: 0, count: 0 })
  })
})

describe('computePerformance', () => {
  it('reports the gain over net deposits', () => {
    const result = computePerformance(120, { in: 100, out: 0, net: 100, count: 1 })
    expect(result).toEqual({ gain: 20, gainPercent: 20, netDeposited: 100, hasBasis: true })
  })

  it('reports a loss', () => {
    const result = computePerformance(80, { in: 100, out: 0, net: 100, count: 1 })
    expect(result.gain).toBe(-20)
    expect(result.gainPercent).toBe(-20)
  })

  it('has no basis at all when there are no transfers', () => {
    const result = computePerformance(500, { in: 0, out: 0, net: 0, count: 0 })
    expect(result).toEqual({ gain: 0, gainPercent: null, netDeposited: 0, hasBasis: false })
  })

  it('returns null percent when more was withdrawn than deposited', () => {
    // The old code answered `profitPercent: 100` here, which is a made-up number:
    // with a negative basis any percentage is an artefact of the sign.
    const result = computePerformance(10, { in: 100, out: 150, net: -50, count: 2 })
    expect(result.gainPercent).toBeNull()
    expect(result.netDeposited).toBe(-50)
    expect(result.hasBasis).toBe(true)
  })

  it('returns null percent when the basis is exactly zero', () => {
    const result = computePerformance(10, { in: 100, out: 100, net: 0, count: 2 })
    expect(result.gainPercent).toBeNull()
  })

  it('reports zero gain for a token that only moved in and out', () => {
    const result = computePerformance(100, { in: 100, out: 0, net: 100, count: 1 })
    expect(result.gain).toBe(0)
    expect(result.gainPercent).toBe(0)
  })
})

describe('buildBalanceSeries', () => {
  const now = 1_700_000_000_000
  const day = 24 * 60 * 60 * 1000

  it('returns nothing to draw when there is no history', () => {
    // It must never invent points: the old generateEmptyChart returned a flat line
    // of 1000 which was rendered as the user's portfolio history.
    expect(buildBalanceSeries([], 500, '1M', 10, now)).toEqual([])
  })

  it('ignores native transfers and failures when shaping the token series', () => {
    const transfers = [
      transfer({ asset: 'NATIVE', timestamp: now - day }),
      transfer({ asset: 'TOKEN', failed: true, timestamp: now - day }),
    ]
    expect(buildBalanceSeries(transfers, 500, '1M', 10, now)).toEqual([])
  })

  it('ends at the current balance', () => {
    // Anchoring on the live balance keeps the chart agreeing with the number
    // printed next to it, even when older history is outside the window.
    const series = buildBalanceSeries(
      [transfer({ amount: '100', direction: 'in', timestamp: now - 5 * day })],
      250,
      '1M',
      10,
      now,
    )
    expect(series.at(-1)!.value).toBe(250)
  })

  it('walks backwards through an incoming transfer', () => {
    const series = buildBalanceSeries(
      [transfer({ amount: '100', direction: 'in', timestamp: now - 5 * day })],
      250,
      '1M',
      30,
      now,
    )
    // Before the deposit the balance was 150; after it, 250.
    expect(series[0].value).toBe(150)
    expect(series.at(-1)!.value).toBe(250)
  })

  it('walks backwards through an outgoing transfer', () => {
    const series = buildBalanceSeries(
      [transfer({ amount: '50', direction: 'out', timestamp: now - 5 * day })],
      100,
      '1M',
      30,
      now,
    )
    expect(series[0].value).toBe(150)
    expect(series.at(-1)!.value).toBe(100)
  })

  it('never dips below zero', () => {
    const series = buildBalanceSeries(
      [transfer({ amount: '500', direction: 'out', timestamp: now - 2 * day })],
      0,
      '1M',
      10,
      now,
    )
    expect(Math.min(...series.map(p => p.value))).toBeGreaterThanOrEqual(0)
  })

  it('produces steps + 1 points, in ascending time order', () => {
    const series = buildBalanceSeries(
      [transfer({ timestamp: now - day })],
      100,
      '1W',
      12,
      now,
    )
    expect(series).toHaveLength(13)
    for (let i = 1; i < series.length; i++) {
      expect(series[i].timestamp).toBeGreaterThan(series[i - 1].timestamp)
    }
    expect(series.at(-1)!.timestamp).toBe(now)
  })
})

describe('periodWindow', () => {
  const now = 1_700_000_000_000
  const day = 24 * 60 * 60 * 1000

  it('uses fixed spans for named periods', () => {
    expect(periodWindow('1D', [], now)).toBe(day)
    expect(periodWindow('1W', [], now)).toBe(7 * day)
    expect(periodWindow('3M', [], now)).toBe(90 * day)
  })

  it('spans back to the oldest transfer for All', () => {
    const window = periodWindow('All', [transfer({ timestamp: now - 10 * day })], now)
    expect(window).toBe(10 * day)
  })

  it('keeps a minimum span of a day so a single recent transfer still plots', () => {
    expect(periodWindow('All', [transfer({ timestamp: now - 1000 })], now)).toBe(day)
  })
})

describe('seriesChange', () => {
  it('measures first to last', () => {
    const change = seriesChange([
      { timestamp: 1, value: 100 },
      { timestamp: 2, value: 150 },
    ])
    expect(change).toEqual({ absolute: 50, percent: 50 })
  })

  it('reports a null percent when the series starts at zero', () => {
    const change = seriesChange([
      { timestamp: 1, value: 0 },
      { timestamp: 2, value: 150 },
    ])
    expect(change.absolute).toBe(150)
    expect(change.percent).toBeNull()
  })

  it('is inert for a series too short to compare', () => {
    expect(seriesChange([])).toEqual({ absolute: 0, percent: null })
    expect(seriesChange([{ timestamp: 1, value: 5 }])).toEqual({ absolute: 0, percent: null })
  })
})
