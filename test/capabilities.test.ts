import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOperation } from '../src/runtime/run.js'
import { operations } from '../src/schema/index.js'
import { capabilities } from '../src/schema/ops/capabilities.js'

const repoRoot = path.resolve(import.meta.dirname, '..')

describe('capabilities operation', () => {
  it('runs offline with exit 0, describing every operation, output schema, and retry policy', async () => {
    const offlineFetch = (() => { throw new Error('offline') }) as unknown as typeof globalThis.fetch
    const result = await runOperation(capabilities, {}, { fetch: offlineFetch })

    expect(result.exit_code).toBe(0)
    expect(result.envelope.ok).toBe(true)
    if (!result.envelope.ok) return

    expect(result.raw).toBeTruthy()
    const parsed = JSON.parse(result.raw!)
    expect(parsed).toEqual(result.envelope.data)

    const names = parsed.operations.map((op: { name: string }) => op.name)
    for (const op of operations) expect(names).toContain(op.name)

    expect(parsed.policy.retries).toBe(2)
    expect(parsed.targets).toEqual({
      ecfr: {
        name: 'ecfr',
        base_url: 'https://www.ecfr.gov',
        description: 'The public eCFR API at ecfr.gov.',
      },
    })
    expect(parsed.default_target).toBe('ecfr')
    expect(parsed.environment.map((entry: { name: string }) => entry.name)).toEqual([
      'ECFR_OUTPUT',
      'ECFR_AGENT',
    ])
    expect(parsed.operations.find((op: { name: string }) => op.name === 'read').untrusted)
      .toEqual(['data.content', 'data.sections'])
    for (const op of parsed.operations) {
      expect(op.output_schema.type).toBe('object')
      expect(typeof op.output_schema.$schema).toBe('string')
      expect(op.output_schema.$schema.length).toBeGreaterThan(0)
    }
    expect(parsed.schemas.envelope).toBeTruthy()
    expect(parsed.schemas.error).toBeTruthy()
  })

  it('the spawned CLI prints the same capabilities document, offline, as JSON on stdout', () => {
    const proc = spawnSync('node', ['--import', 'tsx', 'src/cli.ts', 'capabilities'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })

    expect(proc.status).toBe(0)
    const parsed = JSON.parse(proc.stdout)
    expect(parsed.cli.name).toBe('ecfr')
    expect(parsed.operations.map((op: { name: string }) => op.name).sort())
      .toEqual(operations.map(op => op.name).sort())
    expect(parsed.policy.retries).toBe(2)
  })
})
