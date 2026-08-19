/**
 * Fixed-window rate limiter.
 *
 * Guards two things: password guessing on the login action, and repeated calls to
 * the transfer actions. Both are reachable as public HTTP endpoints, so "the UI
 * only shows one button" is not a limit.
 *
 * Scope and honesty about it: state is per-process memory. On a single server
 * that is a real limit; on serverless hosting each instance keeps its own counter,
 * so the effective limit is (configured limit × instances). That is a meaningful
 * reduction in brute-force throughput but not a hard cap — a deployment that needs
 * one wants a shared store (Redis/Upstash). Documented rather than pretended away.
 */

export type RateLimitResult = {
  allowed: boolean
  /** Attempts left in the current window. */
  remaining: number
  /** When the window resets, unix ms. */
  resetAt: number
}

type Window = { count: number; resetAt: number }

const windows = new Map<string, Window>()

/** Drop expired windows so the map cannot grow without bound. */
function sweep(now: number): void {
  if (windows.size < 512) return
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key)
  }
}

/**
 * Consume one attempt against `key`.
 *
 * @param limit    attempts permitted per window
 * @param windowMs window length in milliseconds
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  sweep(now)

  const existing = windows.get(key)
  if (!existing || existing.resetAt <= now) {
    const fresh: Window = { count: 1, resetAt: now + windowMs }
    windows.set(key, fresh)
    return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt }
  }

  existing.count += 1
  const allowed = existing.count <= limit
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  }
}

/** Forget a key — used after a successful login so one attempt is not held against the user. */
export function resetRateLimit(key: string): void {
  windows.delete(key)
}

/** Test seam. */
export function clearAllRateLimits(): void {
  windows.clear()
}

/** Budgets, kept here so they are visible in one place. */
export const LIMITS = {
  /** Password attempts: deliberately tight. */
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  /** Transfers: enough for real use, low enough to bound damage. */
  transfer: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** Read endpoints: protects the upstream API keys, not the funds. */
  read: { limit: 60, windowMs: 60 * 1000 },
} as const

/**
 * Derive a client key from forwarding headers.
 *
 * `x-forwarded-for` is client-controlled unless a trusted proxy overwrites it, so
 * only the left-most entry behind the platform's own proxy is meaningful. On
 * Vercel `x-real-ip` is set by the platform and preferred.
 */
export function clientKey(headers: {
  get(name: string): string | null
}): string {
  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}
