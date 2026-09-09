import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { operations } from '../../src/schema/index.js'
import { structure } from '../../src/schema/ops/structure.js'
import type { Envelope } from '../../src/schema/types.js'
import { fixtureFetch } from '../helpers/fetch-stub.js'

const goldenDir = path.resolve(import.meta.dirname, '../golden')

/** Inputs match the fixtures recorded by scripts/record-fixtures.ts, plus `titles` with `{}`. */
const specs: Record<string, Record<string, unknown>> = {
  titles: {},
  agencies: {},
  structure: { title: '32', date: '2026-08-17' },
  search: { query: 'controlled unclassified information', title: '32', perPage: 5 },
  counts: { query: 'cybersecurity' },
  changes: { title: '32', part: '2002' },
  corrections: { title: '32' },
  read: { title: '32', part: '2002', section: '2002.14', date: '2026-08-17' },
}

/** Fixed fetched_at, and data truncated to its keys — the schema check already covers the payload. */
function normalize(envelope: Envelope): unknown {
  const clone = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>
  clone.request_id = '<request_id>'
  const source = clone.source as { fetched_at?: string } | null
  if (source) source.fetched_at = '<fetched_at>'
  const data = clone.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    clone.data = { keys: Object.keys(data as Record<string, unknown>) }
  }
  return clone
}

/** Reads the checked-in golden file; writes it (and passes) the first time it is missing. */
async function assertMatchesGolden(name: string, actual: unknown): Promise<void> {
  const file = path.join(goldenDir, `${name}.json`)
  let expected: unknown
  try {
    expected = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(goldenDir, { recursive: true })
    await writeFile(file, `${JSON.stringify(actual, null, 2)}\n`)
    return
  }
  expect(actual).toEqual(expected)
}

const remoteOps = operations.filter(op => op.network === 'remote')

describe('envelope golden', () => {
  it('has a fixture input for every remote operation', () => {
    expect(Object.keys(specs).sort()).toEqual(remoteOps.map(op => op.name).sort())
  })

  for (const op of remoteOps) {
    it(`matches the golden envelope for ${op.name}`, async () => {
      const result = await runOperation(op, specs[op.name], { fetch: fixtureFetch() })
      if (!result.envelope.ok) throw new Error(`expected success for ${op.name}: ${JSON.stringify(result.envelope)}`)
      await assertMatchesGolden(op.name, normalize(result.envelope))
    })
  }

  // structure is exercised separately below (see the BUG note); every other remote op
  // must produce data that validates strictly and no output-schema warning.
  for (const op of remoteOps.filter(candidate => candidate.name !== 'structure')) {
    it(`data for ${op.name} strictly validates its output schema with no warnings`, async () => {
      const result = await runOperation(op, specs[op.name], { fetch: fixtureFetch() })
      if (!result.envelope.ok) throw new Error(`expected success for ${op.name}`)
      expect(op.output.safeParse(result.envelope.data).success).toBe(true)
      expect(result.envelope.warnings).toEqual([])
    })
  }

  it('bounded data for structure still validates its output schema and carries a truncation warning', async () => {
    const result = await runOperation(structure, specs.structure, { fetch: fixtureFetch() })
    if (!result.envelope.ok) throw new Error('expected success for structure')
    expect(structure.output.safeParse(result.envelope.data).success).toBe(true)
    expect(result.envelope.warnings).toContainEqual(expect.objectContaining({ code: 'TRUNCATED' }))
  })
})
