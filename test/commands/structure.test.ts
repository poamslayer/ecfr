import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { structure, structureLevels, type StructureNode } from '../../src/schema/ops/structure.js'
import { fixtureFetch, loadFixture } from '../helpers/fetch-stub.js'

const hierarchy = {
  identifier: '32',
  label: 'Title 32',
  type: 'title',
  children: [{
    identifier: 'I',
    label: 'Chapter I',
    type: 'chapter',
    children: [{
      identifier: '1',
      label: 'Part 1',
      type: 'part',
      children: [{ identifier: '1.1', label: 'Section 1.1', type: 'section' }],
    }],
  }],
}
const currency = {
  titles: [{ number: 32, latest_issue_date: '2026-04-01', latest_amended_on: '2026-03-30', up_to_date_as_of: '2026-04-01' }],
}

function fetchHierarchy(body: unknown = hierarchy): typeof globalThis.fetch {
  return vi.fn(async input => {
    const url = String(input)
    const responseBody = url.endsWith('/titles') ? currency : body
    return new Response(JSON.stringify(responseBody), { headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
}

function findNode(node: StructureNode, identifier: string): StructureNode | undefined {
  if (node.identifier === identifier) return node
  for (const child of node.children ?? []) {
    const match = findNode(child, identifier)
    if (match) return match
  }
  return undefined
}

describe('structure operation', () => {
  it('defaults the issue date through the title currency lookup', async () => {
    const fetch = fetchHierarchy()

    const result = await runOperation(structure, { title: '32' }, { fetch })

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toEqual({
      ...hierarchy,
      children: [{ ...hierarchy.children[0], children: [], withheld_children: 1 }],
    })
    expect(result.envelope.defaulted).toEqual(['date', 'level'])
    expect(result.envelope.params).toEqual({ title: '32', date: '2026-04-01', level: 'chapter' })
    expect(result.envelope.source?.url).toBe('https://www.ecfr.gov/api/versioner/v1/structure/2026-04-01/title-32.json')
  })

  it('keeps the chapter above part 2002 visible in the default Data', async () => {
    const result = await runOperation(structure, { title: '32' }, { fetch: fixtureFetch() })

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')

    const root = result.envelope.data as StructureNode
    const chapter = findNode(root, 'XX')
    expect(chapter).toMatchObject({ identifier: 'XX', type: 'chapter', withheld_children: 6 })
    expect(findNode(root, '2002')).toBeUndefined()
    expect(result.envelope.warnings).not.toContainEqual(expect.objectContaining({ code: 'TRUNCATED' }))
  })

  it('--under defaults the level to part and reaches part 2002', async () => {
    const result = await runOperation(structure, { title: '32', under: 'XX' }, { fetch: fixtureFetch() })

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')
    const root = result.envelope.data as StructureNode
    expect(root).toMatchObject({ identifier: 'XX', type: 'chapter' })
    expect(findNode(root, '2002')).toMatchObject({ identifier: '2002', type: 'part', withheld_children: 4 })
    expect(result.envelope.params).toMatchObject({ under: 'XX', level: 'part' })
    expect(result.envelope.defaulted).toContain('level')
  })

  it('--level all reproduces the untouched upstream tree', async () => {
    const fixture = loadFixture('structure-32')
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-08-17', level: 'all' },
      { fetch: fixtureFetch(), maxBytes: 0 },
    )

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.data).toEqual(fixture.body)
    expect(result.envelope.defaulted).toEqual([])
  })

  it('--under with no match is a Usage error naming under', async () => {
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-04-01', under: 'missing' },
      { fetch: fetchHierarchy() },
    )

    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error).toMatchObject({ code: 'USAGE', field: 'under' })
    expect(result.envelope.error.remediation).toContain('ecfr structure 32')
  })

  it('--under with more than one match reports the count and types', async () => {
    const duplicate = {
      ...hierarchy,
      children: [
        { identifier: 'B', label: 'Subtitle B', type: 'subtitle', children: [] },
        { identifier: 'B', label: 'Chapter B', type: 'chapter', children: [] },
      ],
    }
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-04-01', under: 'B' },
      { fetch: fetchHierarchy(duplicate) },
    )

    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error).toMatchObject({ code: 'USAGE', field: 'under' })
    expect(result.envelope.error.message).toContain('2 nodes at the same level')
    expect(result.envelope.error.remediation).toContain('subtitle:B')
    expect(result.envelope.error.remediation).toContain('chapter:B')
  })

  /**
   * An identifier is not unique across a title. `2` names a chapter in Title 48 and also parts
   * deeper in the tree, so a whole-tree exact match made the documented two-step drill-down fail
   * outright. The shallowest match is what a caller means after reading the chapter list.
   */
  it('--under takes the shallowest match when the same identifier appears deeper', async () => {
    const repeated = {
      ...hierarchy,
      children: [
        {
          identifier: '2',
          label: 'Chapter 2',
          type: 'chapter',
          children: [{ identifier: '252', label: 'Part 252', type: 'part', children: [] }],
        },
        {
          identifier: '3',
          label: 'Chapter 3',
          type: 'chapter',
          children: [{ identifier: '2', label: 'Part 2', type: 'part', children: [] }],
        },
      ],
    }
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-04-01', under: '2' },
      { fetch: fetchHierarchy(repeated) },
    )

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')
    const data = result.envelope.data as { type?: string; children?: { identifier: string }[] }
    expect(data.type).toBe('chapter')
    expect(data.children?.map(child => child.identifier)).toContain('252')
  })

  it('--under accepts a type qualifier to settle a tie at one level', async () => {
    const duplicate = {
      ...hierarchy,
      children: [
        { identifier: 'B', label: 'Subtitle B', type: 'subtitle', children: [] },
        { identifier: 'B', label: 'Chapter B', type: 'chapter', children: [] },
      ],
    }
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-04-01', under: 'chapter:B' },
      { fetch: fetchHierarchy(duplicate) },
    )

    expect(result.exit_code).toBe(0)
    if (!result.envelope.ok) throw new Error('expected success')
    expect((result.envelope.data as { label: string }).label).toBe('Chapter B')
  })

  it('rejects a malformed --under identifier before fetching', async () => {
    const fetch = fetchHierarchy()
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-04-01', under: '../B' },
      { fetch },
    )

    expect(fetch).not.toHaveBeenCalled()
    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error).toMatchObject({ code: 'USAGE', field: 'under' })
  })

  it('rejects an unrecognised --level and lists every accepted value', async () => {
    const fetch = fetchHierarchy()
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-04-01', level: 'division' },
      { fetch },
    )

    expect(fetch).not.toHaveBeenCalled()
    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected failure')
    expect(result.envelope.error).toMatchObject({ code: 'USAGE', field: 'level' })
    for (const level of [...structureLevels, 'all']) {
      expect(result.envelope.error.remediation).toContain(level)
    }
  })
})
