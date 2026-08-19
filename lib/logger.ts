/**
 * Server-side logger with redaction.
 *
 * The previous logger printed RPC URLs (which usually embed the provider key),
 * the address derived from the private key, and full stack traces — at `info` and
 * on every request, in production. Hosting logs are readable by anyone with
 * dashboard access, so that is a credential leak with extra steps.
 *
 * Rules here: `debug` is silent unless explicitly enabled, every value passes
 * through redaction, and errors log a message without a stack in production.
 */

const SENSITIVE_KEY = /key|secret|password|token|mnemonic|private|auth|cookie|session/i
const HEX_KEY = /\b0x[0-9a-fA-F]{64}\b/g

function redactString(value: string): string {
  return value
    // A 32-byte hex string in a log line is a private key.
    .replace(HEX_KEY, '0x<redacted>')
    // Provider URLs carry the key in the path or query.
    .replace(/(https?:\/\/[^\s/]+\/)[^\s?]*/g, '$1<redacted>')
    .replace(/([?&](?:api[-_]?key|apikey|key|token)=)[^&\s]+/gi, '$1<redacted>')
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '<deep>'
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'bigint') return value.toString()
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 20).map(v => redact(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '<redacted>' : redact(v, depth + 1)
  }
  return out
}

const debugEnabled = () => process.env.DASHBOARD_DEBUG === '1'
const inProduction = () => process.env.NODE_ENV === 'production'

function emit(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  data?: unknown,
): void {
  const payload = data === undefined ? '' : redact(data)
  const line = `[${level.toUpperCase()}] ${message}`
  if (level === 'error') console.error(line, payload)
  else if (level === 'warn') console.warn(line, payload)
  else console.log(line, payload)
}

export const logger = {
  info(message: string, data?: unknown) {
    emit('info', message, data)
  },
  warn(message: string, data?: unknown) {
    emit('warn', message, data)
  },
  /** Logs the message; the stack is included only outside production. */
  error(message: string, error?: unknown) {
    if (error instanceof Error) {
      emit('error', message, {
        message: error.message,
        ...(inProduction() ? {} : { stack: error.stack }),
      })
    } else {
      emit('error', message, error)
    }
  },
  debug(message: string, data?: unknown) {
    if (!debugEnabled()) return
    emit('debug', message, data)
  },
}

/**
 * Turn an internal error into something safe to render.
 *
 * Upstream messages can contain URLs and provider detail, so the user gets a
 * stable sentence and the operator gets the detail in the log.
 */
export function publicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && (error as { expose?: boolean }).expose === true) {
    return error.message
  }
  return fallback
}

/** An error whose message is intended for the user. */
export class PublicError extends Error {
  readonly expose = true
  constructor(message: string) {
    super(message)
    this.name = 'PublicError'
  }
}
