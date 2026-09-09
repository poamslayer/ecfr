import { describe, expect, it, vi } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { operations } from '../../src/schema/index.js'
import { capabilities } from '../../src/schema/ops/capabilities.js'
import { schemaVersion } from '../../src/schema/types.js'

interface Contract {
  schema_version: string
  environment: { name: string; description: string }[]
  exit_codes: { exit: number; codes: string[]; when: string }[]
  operations: { name: string; flags: { name: string }[] }[]
}

async function contract(operation?: string): Promise<Contract> {
  const result = await runOperation(capabilities, operation === undefined ? {} : { operation })
  if (!result.envelope.ok) throw new Error(`expected success: ${JSON.stringify(result.envelope)}`)
  return result.envelope.data as Contract
}

describe('scoped introspection', () => {
  it('returns every operation when no operation is named', async () => {
    const data = await contract()
    expect(data.operations.map(op => op.name)).toEqual(operations.map(op => op.name))
  })

  it('returns exactly the named operation when one is named', async () => {
    const data = await contract('read')
    expect(data.operations).toHaveLength(1)
    expect(data.operations[0].name).toBe('read')
  })

  it('gives the scoped response the same top-level keys as the full contract', async () => {
    const full = await contract()
    const scoped = await contract('read')
    expect(Object.keys(scoped).sort()).toEqual(Object.keys(full).sort())
    expect(Object.keys(scoped)).toEqual(expect.arrayContaining([
      'cli',
      'schema_version',
      'policy',
      'targets',
      'default_target',
      'exit_codes',
      'error_codes',
      'environment',
      'global_flags',
      'operations',
      'schemas',
    ]))
  })

  it('rejects an unknown operation name as a USAGE Error code naming the argument', async () => {
    const result = await runOperation(capabilities, { operation: 'describe' })

    expect(result.exit_code).toBe(2)
    if (result.envelope.ok) throw new Error('expected a rejected operation name')
    expect(result.envelope.error.code).toBe('USAGE')
    expect(result.envelope.error.field).toBe('operation')
    for (const op of operations) {
      expect(result.envelope.error.remediation).toContain(op.name)
    }
  })

  it('carries the schema version scoped and unscoped', async () => {
    expect((await contract()).schema_version).toBe(schemaVersion)
    expect((await contract('read')).schema_version).toBe(schemaVersion)
  })

  it('lists every environment variable the CLI reads', async () => {
    const names = (await contract()).environment.map(entry => entry.name)
    expect(names).toEqual(['ECFR_OUTPUT', 'ECFR_AGENT'])
  })

  it('makes the exit code table discoverable through introspection', async () => {
    const table = (await contract()).exit_codes
    expect(table.map(row => row.exit)).toEqual([0, 1, 2, 3, 4])
    expect(table.find(row => row.exit === 2)?.codes).toEqual(['USAGE'])
  })

  it('never calls fetch, scoped or unscoped, with no credentials in play', async () => {
    const fetch = vi.fn(() => { throw new Error('introspection must not touch the network') }) as unknown as typeof globalThis.fetch

    for (const input of [{}, { operation: 'read' }, { operation: 'nope' }]) {
      await runOperation(capabilities, input, { fetch })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists the field mask flag per operation, and not on introspection itself', async () => {
    const full = await contract()
    const flagNames = (name: string) =>
      full.operations.find(op => op.name === name)!.flags.map(flag => flag.name)

    expect(flagNames('read')).toContain('--fields')
    expect(flagNames('capabilities')).not.toContain('--fields')
    for (const op of operations.filter(candidate => candidate.kind !== 'introspect')) {
      expect(flagNames(op.name)).toContain('--fields')
    }
  })
})
