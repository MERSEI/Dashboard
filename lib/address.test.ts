import { describe, it, expect } from 'vitest'
import {
  isValidAddress,
  normalizeAddress,
  isSameAddress,
  shortenAddress,
  parseAddressList,
} from './address'

/** vitalik.eth — a real, correctly checksummed address. */
const CHECKSUMMED = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const LOWER = CHECKSUMMED.toLowerCase()
const OTHER = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'

describe('isValidAddress', () => {
  it('accepts a checksummed address', () => {
    expect(isValidAddress(CHECKSUMMED)).toBe(true)
  })

  it('accepts an all-lowercase address (no checksum to verify)', () => {
    expect(isValidAddress(LOWER)).toBe(true)
  })

  it('accepts an all-uppercase address', () => {
    expect(isValidAddress('0x' + CHECKSUMMED.slice(2).toUpperCase())).toBe(true)
  })

  it('rejects a mixed-case address whose checksum is wrong', () => {
    // This is the case a length check cannot catch: one character mistyped while
    // copying from an explorer, on a path that moves money.
    const broken = CHECKSUMMED.slice(0, 10) + 'A' + CHECKSUMMED.slice(11)
    expect(broken).toHaveLength(42)
    expect(isValidAddress(broken)).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    expect(isValidAddress(`  ${CHECKSUMMED}  `)).toBe(true)
  })

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['missing 0x', CHECKSUMMED.slice(2)],
    ['too short', CHECKSUMMED.slice(0, 41)],
    ['too long', CHECKSUMMED + 'a'],
    ['non-hex characters', '0x' + 'z'.repeat(40)],
    ['an ENS name', 'vitalik.eth'],
    ['a TON address', '0QDwzJzZsH2rII9Sv4krAGIhIn12pEhCj4LYcKa8jdXTd7Pa'],
  ])('rejects %s', (_label, value) => {
    expect(isValidAddress(value)).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 123],
    ['an object', {}],
  ])('rejects a non-string: %s', (_label, value) => {
    expect(isValidAddress(value)).toBe(false)
  })
})

describe('normalizeAddress', () => {
  it('returns the checksummed form for a lowercase input', () => {
    expect(normalizeAddress(LOWER)).toBe(CHECKSUMMED)
  })

  it('is idempotent', () => {
    expect(normalizeAddress(normalizeAddress(LOWER))).toBe(CHECKSUMMED)
  })

  it('returns null rather than throwing on invalid input', () => {
    expect(normalizeAddress('nope')).toBeNull()
    expect(normalizeAddress(null)).toBeNull()
  })
})

describe('isSameAddress', () => {
  it('matches the same account across letter cases', () => {
    expect(isSameAddress(LOWER, CHECKSUMMED)).toBe(true)
  })

  it('does not match different accounts', () => {
    expect(isSameAddress(CHECKSUMMED, OTHER)).toBe(false)
  })

  it('is false when either side is invalid, never accidentally true', () => {
    expect(isSameAddress('junk', 'junk')).toBe(false)
    expect(isSameAddress(null, null)).toBe(false)
    expect(isSameAddress(CHECKSUMMED, null)).toBe(false)
  })
})

describe('shortenAddress', () => {
  it('keeps the corners', () => {
    expect(shortenAddress(CHECKSUMMED)).toBe('0xd8dA…6045')
  })

  it('honours custom lengths', () => {
    expect(shortenAddress(CHECKSUMMED, 4, 6)).toBe('0xd8…A96045')
  })

  it('returns short input unchanged', () => {
    expect(shortenAddress('0xabc', 6, 4)).toBe('0xabc')
  })
})

describe('parseAddressList', () => {
  it('parses a comma-separated list into checksummed form', () => {
    expect(parseAddressList(`${LOWER},${OTHER}`)).toEqual([CHECKSUMMED, OTHER])
  })

  it('accepts spaces, semicolons and newlines as separators', () => {
    expect(parseAddressList(`${LOWER} ; \n ${OTHER}`)).toEqual([CHECKSUMMED, OTHER])
  })

  it('de-duplicates across letter cases', () => {
    expect(parseAddressList(`${LOWER},${CHECKSUMMED}`)).toEqual([CHECKSUMMED])
  })

  it('drops invalid entries instead of keeping them', () => {
    // An allowlist that fails open is not an allowlist.
    expect(parseAddressList(`${LOWER},not-an-address,0x123`)).toEqual([CHECKSUMMED])
  })

  it('returns an empty list for empty or missing input', () => {
    expect(parseAddressList(undefined)).toEqual([])
    expect(parseAddressList('')).toEqual([])
    expect(parseAddressList('   ')).toEqual([])
  })

  it('returns an empty list when every entry is invalid', () => {
    // Which the withdraw path treats as "withdrawals disabled", not "allow all".
    expect(parseAddressList('garbage, also-garbage')).toEqual([])
  })
})
