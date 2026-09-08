import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { counts } from '../../src/schema/ops/counts.js'

describe('counts operation', () => {
  it('returns hierarchy counts for a query and agency', async () => {
    const data = {
      count: { value: 120, relation: 'eq' },
      max_score: 1,
      children: [{
        level: 'title', hierarchy: '32', hierarchy_heading: 'Title 32', heading: 'National Defense',
        count: 45, max_score: 1,
      }],
    }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

    const result = await runOperation(counts, { query: 'cybersecurity', agency: 'defense-department' }, { fetch })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toEqual(data)
    expect(result.envelope.source?.url).toContain('query=cybersecurity')
    expect(result.envelope.source?.url).toContain('agency=defense-department')
  })
})
