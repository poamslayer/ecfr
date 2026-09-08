/**
 * Fixed network policy. No flags override these; they are reported by `capabilities`.
 */
export const policy = {
  /** Retries after the first attempt on 429, 5xx, network errors, and timeouts. */
  retries: 2,
  /** Delay before retry n (ms). */
  backoff_ms: [500, 2000] as const,
  /** Time allowed to receive response headers. */
  headers_timeout_ms: 30_000,
  /** Time allowed to receive the full body after headers. */
  body_timeout_ms: 300_000,
  base_url: 'https://www.ecfr.gov',
} as const

export type Policy = typeof policy
