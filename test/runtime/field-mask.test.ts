import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { read } from '../../src/schema/ops/read.js'
import { search } from '../../src/schema/ops/search.js'
import { structure } from '../../src/schema/ops/structure.js'
import { fixtureFetch } from '../helpers/fetch-stub.js'

const readInput = { title: '32', part: '2002', section: '2002.14', date: '2026-08-17' }
const structureInput = { title: '32', date: '2026-08-17' }
const searchInput = { query: 'controlled unclassified information', title: '32', perPage: 5 }

async function runRead(extra: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  return runOperation(read, { ...readInput, ...extra }, { fetch: fixtureFetch(), ...options })
}

describe('field masks', () => {
  it('keeps only the requested top-level fields', async () => {
    const result = await runRead({ fields: 'title,content' })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(Object.keys(result.envelope.data as object)).toEqual(['title', 'content'])
    expect(result.envelope.data).not.toHaveProperty('sections')
  })

  it('follows the Data key order, not the order the caller listed', async () => {
    const result = await runRead({ fields: 'sections , date ,title' })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(Object.keys(result.envelope.data as object)).toEqual(['title', 'date', 'sections'])
  })

  it('reports the mask in Params without applying or validating it on a Dry run', async () => {
    const result = await runRead({ fields: 'content' }, { dryRun: true })

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.params).toMatchObject({ fields: 'content' })
    expect(result.envelope.dry_run).toBe(true)
    expect(result.envelope.data).toBeNull()
  })

  it('rejects an unknown field name at the usage exit code, naming the argument and the available fields', async () => {
    const result = await runRead({ fields: 'title,paragraphs' })

    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected a rejected mask')
    expect(result.envelope.error.code).toBe('USAGE')
    expect(result.envelope.error.field).toBe('fields')
    expect(result.envelope.error.remediation).toContain('content')
    expect(result.envelope.error.remediation).toContain('sections')
    expect(result.envelope.error.details).toMatchObject({ unknown: ['paragraphs'] })
  })

  it.each(['', ' ', ',', ' , , '])('rejects the mask %j as a USAGE Error code', async fields => {
    const result = await runRead({ fields })

    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected a rejected mask')
    expect(result.envelope.error.code).toBe('USAGE')
    expect(result.envelope.error.field).toBe('fields')
  })

  it('drops an untrusted path whose field the mask removed', async () => {
    const unmasked = await runRead()
    const masked = await runRead({ fields: 'title,sections' })

    if (!unmasked.envelope.ok || !masked.envelope.ok) throw new Error('expected successes')
    expect(unmasked.envelope.untrusted).toEqual(['data.content', 'data.sections'])
    expect(masked.envelope.untrusted).toEqual(['data.sections'])
  })

  it('still bounds an unmasked response and warns that it was truncated', async () => {
    const result = await runOperation(structure, { ...structureInput, level: 'all' }, { fetch: fixtureFetch() })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.warnings).toContainEqual(expect.objectContaining({ code: 'TRUNCATED' }))
  })

  it('drops the truncation Warning when the mask is narrow enough to fit the bound', async () => {
    const result = await runOperation(
      structure,
      { ...structureInput, fields: 'identifier,label,type' },
      { fetch: fixtureFetch() },
    )

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.warnings.some(warning => warning.code === 'TRUNCATED')).toBe(false)
    expect(Object.keys(result.envelope.data as object)).toEqual(['identifier', 'label', 'type'])
  })

  it('validates the unmasked Data against the output schema, so a mask cannot hide a mismatch', async () => {
    // `children[0]` is invalid and is masked away. The mismatch Warning proves the schema
    // check ran on the unmasked payload, which is what keeps OUTPUT_SCHEMA_MISMATCH honest.
    const titles = { titles: [{ number: 32, latest_issue_date: '2026-08-17', latest_amended_on: null, up_to_date_as_of: null }] }
    const tree = {
      identifier: 'title-32',
      label: 'Title 32',
      type: 'title',
      children: [{ identifier: 5, label: 'Chapter I', type: 'chapter' }],
    }
    const fetch = vi.fn(async (input: string | URL | Request) => new Response(
      JSON.stringify(String(input).endsWith('/titles') ? titles : tree),
      { headers: { 'content-type': 'application/json' } },
    )) as typeof globalThis.fetch

    const result = await runOperation(structure, { ...structureInput, fields: 'identifier,label' }, { fetch })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(Object.keys(result.envelope.data as object)).toEqual(['identifier', 'label'])
    expect(structure.output.safeParse(result.envelope.data).success).toBe(true)
    expect(result.envelope.warnings).toContainEqual(expect.objectContaining({ code: 'OUTPUT_SCHEMA_MISMATCH' }))
  })

  it('computes pagination from the full Data even when the mask removes the paging fields', async () => {
    const unmasked = await runOperation(search, searchInput, { fetch: fixtureFetch() })
    const masked = await runOperation(search, { ...searchInput, fields: 'results' }, { fetch: fixtureFetch() })

    if (!unmasked.envelope.ok || !masked.envelope.ok) throw new Error('expected successes')
    expect(Object.keys(masked.envelope.data as object)).toEqual(['results'])
    const { next: maskedNext, ...maskedPaging } = masked.envelope.pagination!
    const { next: _unmaskedNext, ...unmaskedPaging } = unmasked.envelope.pagination!
    expect(maskedPaging).toEqual(unmaskedPaging)
    // The next page keeps the mask, so paging through a masked search stays masked.
    expect(maskedNext).toContain('--fields results')
  })
})

describe('a mask that names no field', () => {
  it('is rejected before any upstream request, so a dry run and a real run agree', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch

    for (const dryRun of [false, true]) {
      const result = await runOperation(read, { title: '32', fields: ',,,' }, { fetch, dryRun })
      expect(result.exit_code).toBe(2)
      if (result.envelope.ok) throw new Error('expected failure')
      expect(result.envelope.error.code).toBe('USAGE')
      expect(result.envelope.error.field).toBe('fields')
    }

    expect(fetch).not.toHaveBeenCalled()
  })
})
