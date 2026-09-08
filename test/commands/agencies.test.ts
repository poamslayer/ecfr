import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { agencies } from '../../src/schema/ops/agencies.js'

const data = {
  agencies: [
    { name: 'Department of Defense', short_name: 'DOD', slug: 'defense-department', cfr_references: [{ title: 32, chapter: 'I' }], children: [] },
    { name: 'Environmental Protection Agency', short_name: 'EPA', slug: 'epa', cfr_references: [], children: [] },
  ],
}

describe('agencies operation', () => {
  it('reports total and matched counts when filtering', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

    const result = await runOperation(agencies, { filter: 'defense' }, { fetch })

    expect(result.envelope.ok).toBe(true)
    if (!result.envelope.ok) return
    expect(result.envelope.data).toEqual({ total: 2, matched: 1, agencies: [data.agencies[0]] })
    expect(result.envelope.source?.url).toBe('https://www.ecfr.gov/api/admin/v1/agencies.json')
  })

  it('sets matched equal to total without a filter', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch
    const result = await runOperation(agencies, {}, { fetch })
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toMatchObject({ total: 2, matched: 2 })
  })
})
