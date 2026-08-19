/**
 * Pure transforms over transaction history: normalisation, flow totals, and the
 * balance series behind the chart.
 *
 * Everything here is a pure function of its arguments so it can be tested without
 * a network, a chain, or a browser — which is what the previous implementation
 * made impossible by mixing fetching, maths and formatting in one server action.
 */

import { formatUnits } from 'ethers'
import { normalizeAddress, isSameAddress } from './address'
import type { RawTx } from './etherscan'

export type AssetKind = 'NATIVE' | 'TOKEN'

export type Transfer = {
  hash: string
  from: string
  to: string | null
  /** Human-readable amount of the asset moved. */
  amount: string
  /** Unix ms. */
  timestamp: number
  direction: 'in' | 'out'
  asset: AssetKind
  symbol: string
  /** True when the transaction reverted; it moved no value. */
  failed: boolean
}

/**
 * Normalise a raw Etherscan row.
 *
 * `to` is null for contract creations. The old code called `tx.to.toLowerCase()`
 * unconditionally, which threw and took down the whole history render.
 */
export function normalizeTransfer(
  raw: RawTx,
  owner: string,
  asset: AssetKind,
  fallbackDecimals: number,
  fallbackSymbol: string,
): Transfer | null {
  const hash = typeof raw.hash === 'string' ? raw.hash : ''
  if (!hash) return null

  const to = normalizeAddress(raw.to)
  const from = normalizeAddress(raw.from) ?? ''

  const decimals =
    asset === 'NATIVE'
      ? 18
      : Number.isFinite(Number(raw.tokenDecimal))
        ? Number(raw.tokenDecimal)
        : fallbackDecimals

  let amount = '0'
  try {
    amount = formatUnits(BigInt(raw.value ?? '0'), decimals)
  } catch {
    amount = '0'
  }

  const seconds = Number(raw.timeStamp ?? 0)
  const timestamp = Number.isFinite(seconds) ? seconds * 1000 : 0

  return {
    hash,
    from,
    to,
    amount,
    timestamp,
    // A transfer to the owner is incoming; everything else (including a
    // contract creation with a null `to`) is outgoing.
    direction: isSameAddress(to, owner) ? 'in' : 'out',
    asset,
    symbol: asset === 'NATIVE' ? 'ETH' : (raw.tokenSymbol || fallbackSymbol),
    failed: raw.isError === '1',
  }
}

/** Newest first, with failed transactions kept but marked. */
export function sortTransfers(transfers: Transfer[]): Transfer[] {
  return [...transfers].sort((a, b) => b.timestamp - a.timestamp)
}

export type Flows = {
  /** Total received. */
  in: number
  /** Total sent. */
  out: number
  /** in − out: what the address is net up by, from transfers alone. */
  net: number
  /** Number of transfers counted. */
  count: number
}

/**
 * Sum incoming and outgoing token flow.
 *
 * Failed transactions are excluded: they appear in the history but moved nothing,
 * and counting them corrupts every figure derived from the totals.
 */
export function computeFlows(transfers: Transfer[], asset: AssetKind = 'TOKEN'): Flows {
  let inTotal = 0
  let outTotal = 0
  let count = 0

  for (const t of transfers) {
    if (t.asset !== asset || t.failed) continue
    const value = Number(t.amount)
    if (!Number.isFinite(value)) continue
    count += 1
    if (t.direction === 'in') inTotal += value
    else outTotal += value
  }

  return { in: inTotal, out: outTotal, net: inTotal - outTotal, count }
}

export type Performance = {
  /** Current balance minus net deposits. */
  gain: number
  /** gain / net deposits, as a percentage. null when there is no basis to divide by. */
  gainPercent: number | null
  /** in − out, the cost basis this compares against. */
  netDeposited: number
  /** False when there were no transfers to reason from. */
  hasBasis: boolean
}

/**
 * Compare the current balance against net deposits.
 *
 * This is deliberately *not* called "profit": without prices at the time of each
 * transfer there is no cost basis, so the only honest statement is "the balance is
 * X more than what was put in". The old code returned `profitPercent: 100`
 * whenever more had been withdrawn than deposited, which is a made-up number.
 * Here that case yields `null` and the UI has to say so.
 */
export function computePerformance(currentBalance: number, flows: Flows): Performance {
  const netDeposited = flows.net

  if (flows.count === 0) {
    return { gain: 0, gainPercent: null, netDeposited: 0, hasBasis: false }
  }

  const gain = currentBalance - netDeposited

  // Dividing by a zero or negative basis has no meaning: more has been taken out
  // than put in, so any percentage would be an artefact of the sign.
  const gainPercent = netDeposited > 0 ? (gain / netDeposited) * 100 : null

  return { gain, gainPercent, netDeposited, hasBasis: true }
}

export type SeriesPoint = { timestamp: number; value: number }

export const PERIODS = ['1D', '1W', '1M', '3M', 'All'] as const
export type Period = (typeof PERIODS)[number]

const PERIOD_MS: Record<Period, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  All: Number.POSITIVE_INFINITY,
}

export function periodWindow(period: Period, transfers: Transfer[], now: number): number {
  if (period !== 'All') return PERIOD_MS[period]
  const oldest = transfers.reduce(
    (min, t) => (t.timestamp > 0 && t.timestamp < min ? t.timestamp : min),
    now,
  )
  // At least a day wide, so a single recent transfer does not produce a zero span.
  return Math.max(now - oldest, PERIOD_MS['1D'])
}

/**
 * Build a balance-over-time series by walking the transfers backwards from the
 * present balance.
 *
 * Anchoring on the *current* balance rather than on zero matters: the address may
 * have held a balance before the window of history we can see, and summing only
 * the visible transfers would draw a line that disagrees with the balance shown
 * next to it.
 *
 * Returns an empty array when there is nothing to draw. It never invents points —
 * the old `generateEmptyChart` returned a flat line of 1000 that was rendered as
 * if it were the user's portfolio history.
 */
export function buildBalanceSeries(
  transfers: Transfer[],
  currentBalance: number,
  period: Period,
  steps = 48,
  now = Date.now(),
): SeriesPoint[] {
  const relevant = transfers
    .filter(t => t.asset === 'TOKEN' && !t.failed && t.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp)

  if (relevant.length === 0) return []

  const window = periodWindow(period, relevant, now)
  const start = now - window
  const stepMs = window / steps

  // Balance at any instant = current balance minus the net effect of every
  // transfer that happened after that instant.
  const points: SeriesPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const timestamp = start + i * stepMs
    let after = 0
    for (const t of relevant) {
      if (t.timestamp <= timestamp) continue
      const value = Number(t.amount)
      if (!Number.isFinite(value)) continue
      after += t.direction === 'in' ? value : -value
    }
    points.push({ timestamp, value: Math.max(0, currentBalance - after) })
  }

  return points
}

/** Change between the first and last point of a series. */
export function seriesChange(points: SeriesPoint[]): { absolute: number; percent: number | null } {
  if (points.length < 2) return { absolute: 0, percent: null }
  const first = points[0].value
  const last = points[points.length - 1].value
  const absolute = last - first
  return { absolute, percent: first > 0 ? (absolute / first) * 100 : null }
}
