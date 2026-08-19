/**
 * Authentication for the write actions.
 *
 * Why this file exists at all: a Next.js Server Action is a public HTTP endpoint.
 * The framework compiles each one into a POST route addressed by an action id that
 * ships inside the client bundle, so anyone who can load the page can invoke any
 * action directly with arguments of their choosing — the UI is not a gate. The
 * previous `withdrawFunds(toAddress, amount)` signed a token transfer with the
 * server's private key to a caller-supplied address with no checks, which made it
 * a public "send funds anywhere" endpoint.
 *
 * The session is a stateless HMAC-signed token in an httpOnly cookie:
 *   <base64url(payload)>.<base64url(hmac-sha256(payload, SESSION_SECRET))>
 * Stateless keeps it working on serverless hosting where no instance memory is
 * shared. The signature is what makes it unforgeable; the expiry inside the
 * payload is what bounds a stolen cookie.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

export const SESSION_COOKIE = 'dash_session'
/** Sessions are short: this cookie authorises moving money. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
/** A password shorter than this is refused at startup rather than at login. */
export const MIN_PASSWORD_LENGTH = 12
const MIN_SECRET_LENGTH = 32

type SessionPayload = {
  /** issued-at, unix ms */
  iat: number
  /** expires-at, unix ms */
  exp: number
  /** random id, so two sessions are never byte-identical */
  jti: string
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Constant-time string comparison that tolerates unequal lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on length mismatch, and the lengths themselves are not
  // secret, so compare fixed-size digests instead of the raw values.
  const da = createHmac('sha256', 'cmp').update(ba).digest()
  const db = createHmac('sha256', 'cmp').update(bb).digest()
  return timingSafeEqual(da, db)
}

/** Anything shaped like an environment: process.env, or a plain object in tests. */
export type EnvLike = Record<string, string | undefined>

export type AuthConfigError = { ok: false; reason: string }
export type AuthConfigOk = { ok: true; password: string; secret: string }

/**
 * Validate the auth configuration.
 *
 * Refusing to run with a weak or missing secret is deliberate: a default or empty
 * `SESSION_SECRET` would let anyone mint a valid session, which is strictly worse
 * than having no login screen at all because it looks protected.
 */
export function readAuthConfig(env: EnvLike = process.env): AuthConfigOk | AuthConfigError {
  const password = env.DASHBOARD_PASSWORD
  const secret = env.SESSION_SECRET

  if (!password || password.includes('your')) {
    return { ok: false, reason: 'DASHBOARD_PASSWORD is not set' }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `DASHBOARD_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
    }
  }
  if (!secret || secret.includes('your')) {
    return { ok: false, reason: 'SESSION_SECRET is not set' }
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      reason: `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    }
  }
  return { ok: true, password, secret }
}

/** Mint a signed session token. */
export function createSessionToken(secret: string, now = Date.now()): string {
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_TTL_MS,
    jti: randomBytes(12).toString('base64url'),
  }
  const encoded = b64url(JSON.stringify(payload))
  return `${encoded}.${sign(encoded, secret)}`
}

export type VerifyResult =
  | { valid: true; payload: SessionPayload }
  | { valid: false; reason: 'malformed' | 'bad-signature' | 'expired' }

/**
 * Verify a session token.
 *
 * The signature is checked before the payload is trusted for anything, including
 * its own expiry — otherwise an attacker could hand us any `exp` they liked.
 */
export function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): VerifyResult {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'malformed' }

  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed' }
  }
  const [encoded, signature] = parts

  if (!safeEqual(signature, sign(encoded, secret))) {
    return { valid: false, reason: 'bad-signature' }
  }

  let payload: SessionPayload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed' }
  }
  if (
    typeof payload?.exp !== 'number' ||
    typeof payload?.iat !== 'number' ||
    typeof payload?.jti !== 'string'
  ) {
    return { valid: false, reason: 'malformed' }
  }
  if (payload.exp <= now) return { valid: false, reason: 'expired' }

  return { valid: true, payload }
}

/** Cookie attributes for the session. */
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}
