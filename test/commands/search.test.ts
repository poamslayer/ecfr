import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { search } from '../../src/schema/ops/search.js'

describe('search operation', () => {
  it('builds query params and adds pagination to the envelope', async () => {
    const data = {
      results: [{
        hierarchy: { title: '32', section: '2002.14' },
        hierarchy_headings: { title: 'National Defense', section: 'Safeguarding' },
        full_text_excerpt: 'controlled unclassified information',
        score: 12.4,
        starts_on: '2025-11-01',
      }],
      meta: { current_page: 1, total_pages: 3, total_count: 47 },
    }
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch

    const result = await runOperation(search, { query: 'CUI', title: '32', page: '1', perPage: '5' }, { fetch })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toEqual(data)
    expect(result.envelope.source?.url).toContain('query=CUI')
    expect(result.envelope.source?.url).toContain('hierarchy%5Btitle%5D=32')
    expect(result.envelope.pagination).toEqual({
      page: 1,
      per_page: 5,
      total: 47,
      total_pages: 3,
      next: 'ecfr search CUI --title 32 --page 2 --per-page 5',
    })
  })
})
