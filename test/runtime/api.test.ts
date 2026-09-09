import { describe, expect, it, vi } from 'vitest'
import packageJson from '../../package.json'
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

  it('requests an encoded upstream representation on every request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch
    await fetchUpstream(request, { fetch, requestId: 'request-123' })
    expect(fetch).toHaveBeenCalledWith('https://www.ecfr.gov/api/test', expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': `ecfr/${packageJson.version} (+https://github.com/poamslayer/ecfr)`,
        'X-Request-Id': 'request-123',
      }),
    }))
  })

  it('omits X-Agent-Name when no agent name is set', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch
    await fetchUpstream(request, { fetch, requestId: 'request-123', agent: null })
    const headers = (fetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers).not.toHaveProperty('X-Agent-Name')
  })

  it('sends X-Agent-Name when an agent name is set', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch
    await fetchUpstream(request, { fetch, requestId: 'request-123', agent: 'audit-agent' })
    const headers = (fetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Agent-Name']).toBe('audit-agent')
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
