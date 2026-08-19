/**
 * Ethereum address handling.
 *
 * Validation goes through ethers rather than a shape check. The previous
 * `addr.startsWith('0x') && addr.length === 42` accepted any 40 hex-ish
 * characters — including a mistyped address and a mixed-case string whose
 * EIP-55 checksum does not match. On a withdrawal path that is the difference
 * between "refused" and "funds sent to an address nobody controls".
 */

import { getAddress, isAddress } from 'ethers'

/** True only for a well-formed address whose EIP-55 checksum holds (if mixed case). */
export function isValidAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return false
  // isAddress accepts all-lowercase and all-uppercase (no checksum to verify) but
  // rejects a mixed-case string with a bad checksum — which is what catches typos
  // in an address copied from a block explorer.
  return isAddress(trimmed)
}

/**
 * Normalise to the EIP-55 checksummed form, for display and for comparison.
 * Returns null when the input is not a valid address.
 */
export function normalizeAddress(value: unknown): string | null {
  if (!isValidAddress(value)) return null
  try {
    return getAddress(value.trim())
  } catch {
    return null
  }
}

/** True when both inputs are valid and refer to the same account. */
export function isSameAddress(a: unknown, b: unknown): boolean {
  const na = normalizeAddress(a)
  const nb = normalizeAddress(b)
  return na !== null && nb !== null && na === nb
}

/** Shorten for display: 0x1234…cdef */
export function shortenAddress(address: string, prefix = 6, suffix = 4): string {
  if (address.length <= prefix + suffix) return address
  return `${address.slice(0, prefix)}…${address.slice(-suffix)}`
}

/**
 * Parse a comma/space separated allowlist of addresses.
 *
 * Invalid entries are dropped rather than silently widening the list: an
 * allowlist that fails open is not an allowlist.
 */
export function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const part of raw.split(/[,\s;]+/)) {
    const norm = normalizeAddress(part)
    if (norm && !out.includes(norm)) out.push(norm)
  }
  return out
}
