import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { titles } from '../../src/schema/ops/titles.js'

describe('titles operation', () => {
  it('returns the upstream titles in the envelope data', async () => {
    const data = {
      titles: [{
        number: 32,
        name: 'National Defense',
        latest_amended_on: '2026-03-30',
        latest_issue_date: '2026-04-01',
        up_to_date_as_of: '2026-04-01',
        reserved: false,
      }],
    }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

    const result = await runOperation(titles, {}, { fetch })

    expect(result.exit_code).toBe(0)
    expect(result.envelope.ok).toBe(true)
    if (!result.envelope.ok) return
    expect(result.envelope.data).toEqual(data)
    expect(result.envelope.source?.url).toBe('https://www.ecfr.gov/api/versioner/v1/titles')
  })

  it('adds a warning when an upstream retry succeeds', async () => {
    const data = {
      titles: [{
        number: 1,
        name: 'General Provisions',
        latest_amended_on: null,
        latest_issue_date: '2026-04-01',
        up_to_date_as_of: '2026-04-01',
        reserved: false,
      }],
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(data), {
        headers: { 'content-type': 'application/json' },
      })) as typeof globalThis.fetch

    const result = await runOperation(titles, {}, { fetch, sleep: () => Promise.resolve() })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.warnings).toEqual([{ code: 'RETRIED', message: 'succeeded after 2 attempts' }])
  })
})
