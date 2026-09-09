import { describe, expect, it, vi } from 'vitest'
import { failure } from '../../src/runtime/envelope.js'
import { writeResult } from '../../src/runtime/output.js'
import { runOperation } from '../../src/runtime/run.js'
import { errorEnvelopeSchema, policy, successEnvelopeSchema } from '../../src/schema/index.js'
import { read } from '../../src/schema/ops/read.js'
import { titles } from '../../src/schema/ops/titles.js'

const noSleep = async () => {}

describe('runtime errors', () => {
  it('maps an upstream 404 to NOT_FOUND, exit 3', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as typeof globalThis.fetch
    const result = await runOperation(titles, {}, { fetch, sleep: noSleep })

    expect(result.exit_code).toBe(3)
    expect(result.envelope.ok).toBe(false)
    if (result.envelope.ok) return
    expect(result.envelope.error.code).toBe('NOT_FOUND')
    expect(errorEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
  })

  it('maps three exhausted 429 responses to RATE_LIMITED, exit 4', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 })) as typeof globalThis.fetch
    const result = await runOperation(titles, {}, { fetch, sleep: noSleep })

    expect(fetch).toHaveBeenCalledTimes(policy.retries + 1)
    expect(result.exit_code).toBe(4)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error.code).toBe('RATE_LIMITED')
    expect(result.envelope.error.retryable).toBe(true)
    expect(errorEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
  })

  it('maps exhausted 5xx responses to UPSTREAM_UNAVAILABLE, exit 4', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 })) as typeof globalThis.fetch
    const result = await runOperation(titles, {}, { fetch, sleep: noSleep })

    expect(result.exit_code).toBe(4)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error.code).toBe('UPSTREAM_UNAVAILABLE')
    expect(errorEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
  })

  it('maps an exhausted network failure to NETWORK, exit 4', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as typeof globalThis.fetch
    const result = await runOperation(titles, {}, { fetch, sleep: noSleep })

    expect(result.exit_code).toBe(4)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error.code).toBe('NETWORK')
    expect(errorEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
  })

  it('maps an exhausted header timeout to TIMEOUT, exit 4', async () => {
    vi.useFakeTimers()
    try {
      const fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch
      const runPromise = runOperation(titles, {}, { fetch, sleep: noSleep })

      const maxAttempts = policy.retries + 1
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await vi.advanceTimersByTimeAsync(policy.headers_timeout_ms + 1)
      }

      const result = await runPromise
      expect(result.exit_code).toBe(4)
      if (result.envelope.ok) throw new Error('expected failure')
      expect(result.envelope.error.code).toBe('TIMEOUT')
      expect(errorEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps a zod validation failure to USAGE, exit 2, with details.issues', async () => {
    // Any param the input schema rejects; `read`'s positional is now widened to accept a
    // citation, so the zod path is exercised through a flag instead.
    const result = await runOperation(read, { title: '32', date: '2026' })

    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error.code).toBe('USAGE')
    expect(Array.isArray(result.envelope.error.details.issues)).toBe(true)
    expect((result.envelope.error.details.issues as unknown[]).length).toBeGreaterThan(0)
    expect(errorEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
  })

  it('maps an unexpected exception to INTERNAL, exit 1', async () => {
    const throwing = { ...titles, transform: () => { throw new Error('boom') } }
    const fetch = vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

    const result = await runOperation(throwing, {}, { fetch })

    expect(result.exit_code).toBe(1)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error.code).toBe('INTERNAL')
    expect(errorEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
  })

  it('validates a success envelope against successEnvelopeSchema', async () => {
    const data = { titles: [], meta: {} }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

    const result = await runOperation(titles, {}, { fetch })

    expect(result.envelope.ok).toBe(true)
    expect(successEnvelopeSchema.safeParse(result.envelope).success).toBe(true)
  })

  describe('writeResult stderr contract', () => {
    const errorEnvelope = failure('titles', {
      code: 'NOT_FOUND',
      message: 'eCFR API returned 404 for /api/versioner/v1/titles',
      status: 404,
      retryable: false,
      remediation: 'Run `ecfr titles` to list valid title numbers.',
      details: {},
    }, { request_id: 'test-request-id', agent: null })

    it('writes exactly one stderr line in JSON mode', () => {
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      writeResult({ envelope: errorEnvelope, exit_code: 3 }, {
        json: true,
        isTTY: false,
        stdout: { write: chunk => stdoutChunks.push(String(chunk)) },
        stderr: { write: chunk => stderrChunks.push(String(chunk)) },
      })

      expect(stderrChunks).toEqual([`error [NOT_FOUND]: ${errorEnvelope.error.message}\n`])
    })

    it('adds a hint line in explicit text mode and writes nothing to stdout', () => {
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      writeResult({ envelope: errorEnvelope, exit_code: 3 }, {
        output: 'text',
        json: false,
        isTTY: true,
        stdout: { write: chunk => stdoutChunks.push(String(chunk)) },
        stderr: { write: chunk => stderrChunks.push(String(chunk)) },
      })

      expect(stdoutChunks).toEqual([])
      expect(stderrChunks).toEqual([
        `error [NOT_FOUND]: ${errorEnvelope.error.message}\n`,
        `hint: ${errorEnvelope.error.remediation}\n`,
      ])
    })
  })
})
