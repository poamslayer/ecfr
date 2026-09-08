import { policy } from '../schema/policy.js'
import type { UpstreamRequest, UpstreamResponse } from '../schema/types.js'
import { CliError } from './errors.js'

export interface FetchDeps {
  fetch?: typeof globalThis.fetch
  sleep?: (milliseconds: number) => Promise<void>
}

const defaultSleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

class RequestTimeout extends Error {
  constructor(readonly phase: 'headers' | 'body') {
    super(`Timed out waiting for upstream ${phase}.`)
    this.name = 'RequestTimeout'
  }
}

async function withTimeout<T>(
  work: Promise<T>,
  milliseconds: number,
  controller: AbortController,
  phase: 'headers' | 'body',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new RequestTimeout(phase))
    }, milliseconds)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function attemptsDetails(req: UpstreamRequest, attempts: number): Record<string, unknown> {
  return { path: req.path, attempts }
}

function transientError(err: unknown, req: UpstreamRequest, attempts: number): CliError {
  if (err instanceof RequestTimeout || (err instanceof Error && err.name === 'AbortError')) {
    const phase = err instanceof RequestTimeout ? err.phase : 'headers'
    return new CliError('TIMEOUT', `eCFR API timed out during ${phase} for ${req.path}`, {
      details: { ...attemptsDetails(req, attempts), phase },
    })
  }
  return new CliError('NETWORK', `Could not reach ecfr.gov for ${req.path}`, {
    details: {
      ...attemptsDetails(req, attempts),
      cause: err instanceof Error ? err.message : String(err),
    },
  })
}

export async function fetchUpstream(req: UpstreamRequest, deps: FetchDeps = {}): Promise<UpstreamResponse> {
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const sleep = deps.sleep ?? defaultSleep
  const url = `${policy.base_url}${req.path}`
  const maxAttempts = policy.retries + 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    let response: Response
    try {
      response = await withTimeout(
        fetchImpl(url, {
          headers: {
            Accept: req.accept === 'json' ? 'application/json' : 'application/xml',
            'Accept-Encoding': 'gzip, deflate',
          },
          signal: controller.signal,
        }),
        policy.headers_timeout_ms,
        controller,
        'headers',
      )
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(policy.backoff_ms[attempt - 1])
        continue
      }
      throw transientError(err, req, attempt)
    }

    if (response.status === 404) {
      throw new CliError('NOT_FOUND', `eCFR API returned 404 for ${req.path}`, {
        status: 404,
        remediation: 'Run `ecfr titles` to list valid title numbers.',
        details: attemptsDetails(req, attempt),
      })
    }

    const retryableStatus = response.status === 429 || response.status >= 500
    if (retryableStatus) {
      if (attempt < maxAttempts) {
        await sleep(policy.backoff_ms[attempt - 1])
        continue
      }
      const code = response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE'
      throw new CliError(code, `eCFR API returned ${response.status} for ${req.path}`, {
        status: response.status,
        details: attemptsDetails(req, attempt),
      })
    }

    if (!response.ok) {
      throw new CliError('UPSTREAM_ERROR', `eCFR API returned ${response.status} for ${req.path}`, {
        status: response.status,
        details: attemptsDetails(req, attempt),
      })
    }

    const contentType = response.headers.get('content-type') ?? ''
    try {
      const body = await withTimeout(
        req.accept === 'json' && contentType.toLowerCase().includes('json')
          ? response.json()
          : response.text(),
        policy.body_timeout_ms,
        controller,
        'body',
      )
      return {
        body,
        url,
        fetched_at: new Date().toISOString(),
        content_type: contentType,
        attempts: attempt,
      }
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(policy.backoff_ms[attempt - 1])
        continue
      }
      throw transientError(err, req, attempt)
    }
  }

  throw new CliError('INTERNAL', `No upstream attempt was made for ${req.path}`)
}
