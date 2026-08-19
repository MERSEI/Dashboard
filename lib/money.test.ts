import { describe, it, expect } from 'vitest'
import {
  isValidAmount,
  toBaseUnits,
  fromBaseUnits,
  formatDisplay,
  formatSigned,
  AmountError,
} from './money'

describe('isValidAmount', () => {
  it.each(['0', '1', '1.5', '.5', '2.', '000.100', '12345.678901'])('accepts %o', v => {
    expect(isValidAmount(v)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['bare dot', '.'],
    ['negative', '-1'],
    ['scientific', '1e6'],
    ['two dots', '1.2.3'],
    ['comma decimal', '1,5'],
    ['hex', '0x10'],
    ['letters', 'abc'],
    ['trailing unit', '10 USDC'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
  ])('rejects %s', (_label, v) => {
    expect(isValidAmount(v)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isValidAmount(5)).toBe(false)
    expect(isValidAmount(null)).toBe(false)
  })
})

describe('toBaseUnits', () => {
  it('scales by the token decimals it is given', () => {
    expect(toBaseUnits('1', 6)).toBe(BigInt('1000000'))
    expect(toBaseUnits('1', 18)).toBe(BigInt('1000000000000000000'))
  })

  it('does not assume six decimals', () => {
    // The old code called parseUnits(amount, 6) unconditionally, which scales an
    // 18-decimal token by a factor of a trillion.
    expect(toBaseUnits('2.5', 18)).toBe(BigInt('2500000000000000000'))
    expect(toBaseUnits('2.5', 6)).toBe(BigInt('2500000'))
  })

  it('handles fractional input', () => {
    expect(toBaseUnits('0.000001', 6)).toBe(BigInt(1))
    expect(toBaseUnits('.5', 6)).toBe(BigInt('500000'))
  })

  it('refuses more precision than the token has, rather than truncating value', () => {
    expect(() => toBaseUnits('1.0000001', 6)).toThrow(AmountError)
    expect(() => toBaseUnits('1.0000001', 6)).toThrow(/6 decimals/)
  })

  it('accepts precision exactly at the limit', () => {
    expect(toBaseUnits('1.000001', 6)).toBe(BigInt('1000001'))
  })

  it('refuses zero and malformed amounts', () => {
    expect(() => toBaseUnits('0', 6)).toThrow(/greater than 0/)
    expect(() => toBaseUnits('0.0', 6)).toThrow(/greater than 0/)
    expect(() => toBaseUnits('abc', 6)).toThrow(/plain decimal/)
    expect(() => toBaseUnits('-1', 6)).toThrow(/plain decimal/)
    expect(() => toBaseUnits('1e6', 6)).toThrow(/plain decimal/)
  })

  it('refuses nonsensical decimals', () => {
    expect(() => toBaseUnits('1', -1)).toThrow(/decimals/)
    expect(() => toBaseUnits('1', 1.5)).toThrow(/decimals/)
    expect(() => toBaseUnits('1', 99)).toThrow(/decimals/)
  })

  it('round-trips through fromBaseUnits', () => {
    expect(fromBaseUnits(toBaseUnits('123.456', 6), 6)).toBe('123.456')
  })
})

describe('fromBaseUnits', () => {
  it('formats without rounding', () => {
    expect(fromBaseUnits(BigInt('1000001'), 6)).toBe('1.000001')
  })

  it('accepts a string input', () => {
    expect(fromBaseUnits('2500000', 6)).toBe('2.5')
  })

  it('formats zero', () => {
    expect(fromBaseUnits(BigInt(0), 6)).toBe('0.0')
  })
})

describe('formatDisplay', () => {
  it('groups thousands and fixes the decimals', () => {
    expect(formatDisplay(1234567.891)).toBe('1,234,567.89')
  })

  it('honours a decimal count', () => {
    expect(formatDisplay(1.23456, 4)).toBe('1.2346')
  })

  it('renders a dash for non-finite values rather than "NaN"', () => {
    expect(formatDisplay(Number.NaN)).toBe('—')
    expect(formatDisplay(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('formatSigned', () => {
  it('marks gains and losses explicitly', () => {
    expect(formatSigned(12.5)).toBe('+12.50')
    expect(formatSigned(-12.5)).toBe('−12.50')
  })

  it('leaves zero unsigned', () => {
    expect(formatSigned(0)).toBe('0.00')
  })

  it('uses a real minus sign, not a hyphen', () => {
    expect(formatSigned(-1)).toContain('−')
    expect(formatSigned(-1)).not.toContain('-')
  })

  it('renders a dash for non-finite values', () => {
    expect(formatSigned(Number.NaN)).toBe('—')
  })
})
