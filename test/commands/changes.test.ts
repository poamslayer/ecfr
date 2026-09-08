import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { changes } from '../../src/schema/ops/changes.js'

describe('changes operation', () => {
  it('returns changes and title currency with optional filters', async () => {
    const data = {
      content_versions: [{
        date: '2026-03-15', amendment_date: '2026-03-10', identifier: 'title-32',
        name: 'National Defense', part: '2002', substantive: true,
      }],
    }
    const titles = {
      titles: [{ number: 32, latest_issue_date: '2026-04-01', latest_amended_on: '2026-03-30', up_to_date_as_of: '2026-04-01' }],
    }
    const fetch = vi.fn(async input => new Response(
      JSON.stringify(String(input).endsWith('/titles') ? titles : data),
      { headers: { 'content-type': 'application/json' } },
    )) as typeof globalThis.fetch

    const result = await runOperation(changes, { title: '32', part: '2002', since: '2025-01-01' }, { fetch })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toEqual(data)
    expect(result.envelope.source?.url).toContain('part=2002')
    expect(result.envelope.source?.url).toContain('issue_date%5Bgte%5D=2025-01-01')
    expect(result.envelope.currency).toEqual({
      date: '2026-04-01',
      latest_amended_on: '2026-03-30',
      up_to_date_as_of: '2026-04-01',
    })
  })
})
