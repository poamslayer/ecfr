import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { readEnv } from '../../src/schema/env.js'
import { capabilities } from '../../src/schema/ops/capabilities.js'
import { read } from '../../src/schema/ops/read.js'
import { search } from '../../src/schema/ops/search.js'
import { titles } from '../../src/schema/ops/titles.js'
import { fixtureFetch } from '../helpers/fetch-stub.js'

const issueDate = '2026-08-17'

describe('identifier validation', () => {
  const adversarial = [
    ['part', '../../etc/passwd'],
    ['section', '2002.14?foo=bar'],
    ['part', '2002%2E14'],
    ['section', '2002.14#frag'],
    ['section', '2002.14\x00'],
    ['part', 'a'.repeat(65)],
    ['section', ''],
    ['part', 'a..b'],
  ] as const

  it.each(adversarial)('rejects malformed %s identifier %j without fetching', async (field, value) => {
    const fetch = vi.fn(fixtureFetch()) as unknown as typeof globalThis.fetch
    const result = await runOperation(read, {
      title: '32',
      date: issueDate,
      [field]: value,
    }, { fetch, dryRun: true })

    expect(fetch).not.toHaveBeenCalled()
    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected a rejected identifier')
    expect(result.envelope.error.code).toBe('USAGE')
    expect(result.envelope.error.field).toBe(field)
  })

  it.each(['252.204-7012', '1.1031(a)-1', '136a', '1.148-1A'])('accepts awkward real identifier %s', async value => {
    for (const field of ['part', 'section'] as const) {
      const result = await runOperation(read, {
        title: '32',
        date: issueDate,
        [field]: value,
      }, { dryRun: true, fetch: fixtureFetch() })
      expect(result.exit_code).toBe(0)
      expect(result.envelope.ok).toBe(true)
    }
  })

  it('uses argument-specific section Remediation and retains retryability metadata', async () => {
    const result = await runOperation(read, { title: '32', date: issueDate, section: 'a..b' })
    if (result.envelope.ok) throw new Error('expected a rejected section')
    expect(result.envelope.error).toHaveProperty('retryable', false)
    expect(result.envelope.error).toHaveProperty('remediation')
    expect(result.envelope.error.remediation.toLowerCase()).toContain('section')
    expect(result.envelope.error.remediation).not.toContain('ecfr titles')
  })

  it('enriches an upstream 404 from the effective section Params', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as typeof globalThis.fetch
    const result = await runOperation(read, {
      title: '32',
      date: issueDate,
      part: '2002',
      section: '2002.14',
    }, { fetch })

    if (result.envelope.ok) throw new Error('expected NOT_FOUND')
    expect(result.envelope.error.code).toBe('NOT_FOUND')
    expect(result.envelope.error.field).toBe('section')
    expect(result.envelope.error.remediation.toLowerCase()).toContain('section')
    expect(result.envelope.error.remediation).not.toContain('ecfr titles')
  })
})

describe('Envelope attribution and untrusted paths', () => {
  it('always includes target, untrusted paths, request id, and agent on an offline success', async () => {
    const result = await runOperation(capabilities, {}, { requestId: 'offline-request', agent: null })
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope).toMatchObject({
      target: 'ecfr',
      untrusted: [],
      request_id: 'offline-request',
      agent: null,
    })
  })

  it('reports the eventual untrusted paths on a Dry run', async () => {
    const result = await runOperation(read, {
      title: '32',
      date: issueDate,
      section: '2002.14',
    }, { dryRun: true, fetch: fixtureFetch(), requestId: 'dry-request', agent: 'dry-agent' })
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope).toMatchObject({
      target: 'ecfr',
      untrusted: ['data.content', 'data.sections'],
      request_id: 'dry-request',
      agent: 'dry-agent',
      dry_run: true,
      data: null,
    })
  })

  it('declares narrower untrusted paths for read and search', async () => {
    const fetch = fixtureFetch()
    const readResult = await runOperation(read, {
      title: '32', part: '2002', section: '2002.14', date: issueDate,
    }, { fetch })
    const searchResult = await runOperation(search, {
      query: 'controlled unclassified information', title: '32', perPage: 5,
    }, { fetch })
    if (!readResult.envelope.ok || !searchResult.envelope.ok) throw new Error('expected successes')
    expect(readResult.envelope.untrusted).toEqual(['data.content', 'data.sections'])
    expect(searchResult.envelope.untrusted).toEqual(['data.results'])
  })

  it('mints a different request id for each run', async () => {
    const first = await runOperation(capabilities, {})
    const second = await runOperation(capabilities, {})
    expect(first.envelope.request_id).not.toBe(second.envelope.request_id)
  })

  it('does not let the self-reported agent name affect Data', async () => {
    const absentEnvironment = readEnv({})
    const presentEnvironment = readEnv({ ECFR_AGENT: 'audit-agent' })
    const withoutAgent = await runOperation(capabilities, {}, {
      requestId: 'same-request',
      agent: absentEnvironment.agent ?? null,
    })
    const withAgent = await runOperation(capabilities, {}, {
      requestId: 'same-request',
      agent: presentEnvironment.agent ?? null,
    })
    if (!withoutAgent.envelope.ok || !withAgent.envelope.ok) throw new Error('expected successes')
    expect(withAgent.envelope.data).toEqual(withoutAgent.envelope.data)
    const { agent: absentAgent, ...absentRest } = withoutAgent.envelope
    const { agent: presentAgent, ...presentRest } = withAgent.envelope
    expect(absentAgent).toBeNull()
    expect(presentAgent).toBe('audit-agent')
    expect(presentRest).toEqual(absentRest)
  })

  it('echoes the request id sent to upstream and omits an unset agent header', async () => {
    const inner = fixtureFetch()
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => inner(input, init)) as unknown as typeof globalThis.fetch
    const result = await runOperation(titles, {}, { fetch, requestId: 'wire-request', agent: null })
    if (!result.envelope.ok) throw new Error('expected success')
    const headers = (fetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Request-Id']).toBe(result.envelope.request_id)
    expect(headers['User-Agent']).toMatch(/^ecfr\/\d+\.\d+\.\d+ /)
    expect(headers).not.toHaveProperty('X-Agent-Name')
  })
})
