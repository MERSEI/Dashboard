import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  createSessionToken,
  verifySessionToken,
  readAuthConfig,
  safeEqual,
  sessionCookieOptions,
  SESSION_TTL_MS,
  MIN_PASSWORD_LENGTH,
} from './auth'

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('hunter2hunter2', 'hunter2hunter2')).toBe(true)
  })

  it('rejects different strings', () => {
    expect(safeEqual('hunter2hunter2', 'hunter2hunter3')).toBe(false)
  })

  it('rejects strings of different length without throwing', () => {
    // timingSafeEqual throws on a length mismatch; comparing digests avoids both
    // the throw and the length-based early exit.
    expect(() => safeEqual('short', 'much longer value')).not.toThrow()
    expect(safeEqual('short', 'much longer value')).toBe(false)
  })

  it('handles empty strings', () => {
    expect(safeEqual('', '')).toBe(true)
    expect(safeEqual('', 'x')).toBe(false)
  })

  it('is not fooled by unicode of equal byte length', () => {
    expect(safeEqual('é', 'e')).toBe(false)
  })
})

describe('readAuthConfig', () => {
  const good = { DASHBOARD_PASSWORD: 'p'.repeat(16), SESSION_SECRET: SECRET }

  it('accepts a strong configuration', () => {
    const result = readAuthConfig(good)
    expect(result.ok).toBe(true)
  })

  it.each([
    ['a missing password', { SESSION_SECRET: SECRET }, /DASHBOARD_PASSWORD/],
    ['a placeholder password', { ...good, DASHBOARD_PASSWORD: 'your-password' }, /DASHBOARD_PASSWORD/],
    ['a short password', { ...good, DASHBOARD_PASSWORD: 'short' }, /at least/],
    ['a missing secret', { DASHBOARD_PASSWORD: 'p'.repeat(16) }, /SESSION_SECRET/],
    ['a placeholder secret', { ...good, SESSION_SECRET: 'your-secret-here-padded-to-32ch' }, /SESSION_SECRET/],
    ['a short secret', { ...good, SESSION_SECRET: 'tooshort' }, /at least/],
  ])('refuses %s', (_label, env, pattern) => {
    // Running with a weak or absent secret is worse than having no login at all:
    // the page looks protected while anyone can mint a session.
    const result = readAuthConfig(env)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(pattern)
  })

  it('requires a password of at least the documented length', () => {
    const result = readAuthConfig({
      ...good,
      DASHBOARD_PASSWORD: 'x'.repeat(MIN_PASSWORD_LENGTH - 1),
    })
    expect(result.ok).toBe(false)
  })
})

describe('session tokens', () => {
  it('round-trips a freshly minted token', () => {
    const token = createSessionToken(SECRET)
    const result = verifySessionToken(token, SECRET)
    expect(result.valid).toBe(true)
  })

  it('carries an expiry one TTL ahead', () => {
    const now = 1_700_000_000_000
    const result = verifySessionToken(createSessionToken(SECRET, now), SECRET, now + 1000)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.payload.exp).toBe(now + SESSION_TTL_MS)
      expect(result.payload.iat).toBe(now)
    }
  })

  it('issues a distinct token each time', () => {
    const now = 1_700_000_000_000
    expect(createSessionToken(SECRET, now)).not.toBe(createSessionToken(SECRET, now))
  })

  it('rejects a token signed with another secret', () => {
    const result = verifySessionToken(createSessionToken(OTHER_SECRET), SECRET)
    expect(result).toEqual({ valid: false, reason: 'bad-signature' })
  })

  it('rejects a tampered payload', () => {
    // The whole point of the signature: an attacker rewriting `exp` must fail.
    const token = createSessionToken(SECRET)
    const [, signature] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ iat: 0, exp: Date.now() + 10 ** 9, jti: 'forged' }),
    ).toString('base64url')
    const result = verifySessionToken(`${forged}.${signature}`, SECRET)
    expect(result).toEqual({ valid: false, reason: 'bad-signature' })
  })

  it('rejects an expired token', () => {
    const now = 1_700_000_000_000
    const token = createSessionToken(SECRET, now)
    const result = verifySessionToken(token, SECRET, now + SESSION_TTL_MS + 1)
    expect(result).toEqual({ valid: false, reason: 'expired' })
  })

  it('treats the expiry boundary as expired', () => {
    const now = 1_700_000_000_000
    const token = createSessionToken(SECRET, now)
    expect(verifySessionToken(token, SECRET, now + SESSION_TTL_MS).valid).toBe(false)
  })

  it('checks the signature before trusting the payload', () => {
    // A forged token claiming a far-future expiry must be refused for its
    // signature, not accepted because its own claim looks fine.
    const forged = Buffer.from(
      JSON.stringify({ iat: 0, exp: Date.now() + 10 ** 9, jti: 'x' }),
    ).toString('base64url')
    const result = verifySessionToken(`${forged}.not-a-signature`, SECRET)
    expect(result).toEqual({ valid: false, reason: 'bad-signature' })
  })

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['no separator', 'abcdef'],
    ['empty payload half', '.signature'],
    ['empty signature half', 'payload.'],
    ['three parts', 'a.b.c'],
  ])('rejects a malformed token: %s', (_label, token) => {
    expect(verifySessionToken(token as string | undefined, SECRET).valid).toBe(false)
  })

  it('rejects a correctly signed payload that is not valid JSON', () => {
    const encoded = Buffer.from('not json').toString('base64url')
    const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url')
    expect(verifySessionToken(`${encoded}.${signature}`, SECRET)).toEqual({
      valid: false,
      reason: 'malformed',
    })
  })

  it('rejects a signed payload missing required fields', () => {
    const encoded = Buffer.from(JSON.stringify({ exp: Date.now() + 1000 })).toString('base64url')
    const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url')
    expect(verifySessionToken(`${encoded}.${signature}`, SECRET)).toEqual({
      valid: false,
      reason: 'malformed',
    })
  })
})

describe('sessionCookieOptions', () => {
  it('is httpOnly and strict, so script cannot read it and it does not ride along cross-site', () => {
    const options = sessionCookieOptions(true)
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('strict')
    expect(options.secure).toBe(true)
    expect(options.path).toBe('/')
  })

  it('drops the secure flag outside production so local http works', () => {
    expect(sessionCookieOptions(false).secure).toBe(false)
  })

  it('expires with the token rather than outliving it', () => {
    expect(sessionCookieOptions(true).maxAge).toBe(SESSION_TTL_MS / 1000)
  })
})
