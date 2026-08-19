/**
 * Amount parsing and formatting.
 *
 * Two rules drive this module:
 *
 *  1. Decimals are never assumed. The old code called `parseUnits(amount, 6)`
 *     while reading the real `decimals()` from the contract elsewhere; against an
 *     18-decimal token that scales every transfer by 10^12.
 *  2. Amount strings are validated before they reach `parseUnits`. Anything that
 *     is not a plain non-negative decimal is refused rather than coerced.
 */

import { parseUnits, formatUnits } from 'ethers'

/** A plain non-negative decimal: "0", "1", "1.5", ".5", "2." */
const DECIMAL_RE = /^\d*(\.\d*)?$/

export class AmountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmountError'
  }
}

/** True when the string is a plain non-negative decimal number. */
export function isValidAmount(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '.') return false
  return DECIMAL_RE.test(trimmed)
}

/**
 * Convert a decimal amount string to base units for a token with `decimals`.
 * Throws AmountError on malformed input or on more precision than the token has.
 */
export function toBaseUnits(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AmountError(`Unsupported token decimals: ${decimals}`)
  }
  if (!isValidAmount(amount)) {
    throw new AmountError('Amount must be a plain decimal number, e.g. 12.50')
  }
  const trimmed = amount.trim()
  const [, frac = ''] = trimmed.split('.')
  if (frac.length > decimals) {
    throw new AmountError(
      `This token has ${decimals} decimals; ${frac.length} were given.`,
    )
  }
  const units = parseUnits(trimmed, decimals)
  if (units <= BigInt(0)) throw new AmountError('Amount must be greater than 0')
  return units
}

/** Format base units as a decimal string, without rounding. */
export function fromBaseUnits(units: bigint | string, decimals: number): string {
  return formatUnits(units, decimals)
}

/**
 * Format a number for display with a fixed number of decimals and thousands
 * separators. Only for presentation — never feed the result back into parsing.
 */
export function formatDisplay(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Format a signed value with an explicit + or − sign. */
export function formatSigned(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatDisplay(Math.abs(value), decimals)}`
}
