import { describe, expect, it, vi } from 'vitest'
import { fetchUpstream } from '../../src/runtime/api.js'
import { CliError } from '../../src/runtime/errors.js'

const request = { path: '/api/test', accept: 'json' as const }
const noSleep = () => Promise.resolve()

async function getError(fetch: typeof globalThis.fetch): Promise<CliError> {
  try {
    await fetchUpstream(request, { fetch, sleep: noSleep })
    throw new Error('expected fetchUpstream to reject')
  } catch (err) {
    if (!(err instanceof CliError)) throw err
    return err
  }
}

describe('fetchUpstream', () => {
  it('parses JSON data when the content type is JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch
    const res = await fetchUpstream(request, { fetch })
    expect(res.body).toEqual({ ok: true })
    expect(res.attempts).toBe(1)
  })

  it('maps 404 to NOT_FOUND without retrying', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as typeof globalThis.fetch
    const err = await getError(fetch)
    expect(err.code).toBe('NOT_FOUND')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('maps three 429 responses to RATE_LIMITED with attempts', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 })) as typeof globalThis.fetch
    const err = await getError(fetch)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.details.attempts).toBe(3)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('maps exhausted 5xx responses to UPSTREAM_UNAVAILABLE', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 })) as typeof globalThis.fetch
    expect((await getError(fetch)).code).toBe('UPSTREAM_UNAVAILABLE')
  })

  it('maps exhausted fetch rejection to NETWORK', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as typeof globalThis.fetch
    expect((await getError(fetch)).code).toBe('NETWORK')
  })

  it('maps abort rejection to TIMEOUT', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) as typeof globalThis.fetch
    expect((await getError(fetch)).code).toBe('TIMEOUT')
  })

  it('maps another 4xx response to UPSTREAM_ERROR', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 400 })) as typeof globalThis.fetch
    expect((await getError(fetch)).code).toBe('UPSTREAM_ERROR')
  })
})
