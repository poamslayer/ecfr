import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { structure } from '../../src/schema/ops/structure.js'

const hierarchy = {
  identifier: 'title-32',
  label: 'Title 32',
  children: [{ identifier: 'chapter-I', label: 'Chapter I', children: [] }],
}
const currency = {
  titles: [{ number: 32, latest_issue_date: '2026-04-01', latest_amended_on: '2026-03-30', up_to_date_as_of: '2026-04-01' }],
}

describe('structure operation', () => {
  it('defaults the issue date through the title currency lookup', async () => {
    const fetch = vi.fn(async input => {
      const url = String(input)
      const body = url.endsWith('/titles') ? currency : hierarchy
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    }) as typeof globalThis.fetch

    const result = await runOperation(structure, { title: '32' }, { fetch })

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toEqual(hierarchy)
    expect(result.envelope.defaulted).toEqual(['date'])
    expect(result.envelope.params).toEqual({ title: '32', date: '2026-04-01' })
    expect(result.envelope.source?.url).toBe('https://www.ecfr.gov/api/versioner/v1/structure/2026-04-01/title-32.json')
  })
})
