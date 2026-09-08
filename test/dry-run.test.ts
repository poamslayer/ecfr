import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../src/runtime/run.js'
import { agencies } from '../src/schema/ops/agencies.js'
import { read } from '../src/schema/ops/read.js'
import { fixtureFetch } from './helpers/fetch-stub.js'

describe('dry run', () => {
  it('resolves the request and currency for a title-scoped op without fetching the data', async () => {
    const inner = fixtureFetch()
    const spy = vi.fn((input: string | URL | Request, init?: RequestInit) => inner(input, init)) as unknown as typeof globalThis.fetch

    const result = await runOperation(read, { title: '32', part: '2002' }, { fetch: spy, dryRun: true })

    // Only the small title list is fetched, to resolve the defaulted issue date — never
    // the (potentially huge) regulation text itself.
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('https://www.ecfr.gov/api/versioner/v1/titles')

    expect(result.envelope.ok).toBe(true)
    if (!result.envelope.ok) return
    expect(result.envelope.dry_run).toBe(true)
    expect(result.envelope.data).toBeNull()
    expect(result.envelope.source).toEqual({
      url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-08-17/title-32.xml?part=2002',
      fetched_at: null,
    })
    expect(result.envelope.defaulted).toEqual(['date'])
    expect(result.envelope.currency).toBeDefined()
  })

  it('makes no fetch calls at all for a non title-scoped op', async () => {
    const spy = vi.fn(fixtureFetch()) as unknown as typeof globalThis.fetch

    const result = await runOperation(agencies, {}, { fetch: spy, dryRun: true })

    expect(spy).not.toHaveBeenCalled()
    expect(result.envelope.ok).toBe(true)
    if (!result.envelope.ok) return
    expect(result.envelope.dry_run).toBe(true)
    expect(result.envelope.data).toBeNull()
    expect(result.envelope.source?.url).toBe('https://www.ecfr.gov/api/admin/v1/agencies.json')
    expect(result.envelope.currency).toBeUndefined()
  })
})
