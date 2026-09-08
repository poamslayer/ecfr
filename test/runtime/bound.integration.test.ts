import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runOperation } from '../../src/runtime/run.js'
import { capabilities } from '../../src/schema/ops/capabilities.js'
import { read } from '../../src/schema/ops/read.js'
import { structure } from '../../src/schema/ops/structure.js'
import { fixtureFetch, loadFixture } from '../helpers/fetch-stub.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('Data byte bound', () => {
  it('bounds the largest-response operation at 256 KiB by default', async () => {
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-08-17' },
      { fetch: fixtureFetch() },
    )

    if (!result.envelope.ok) throw new Error('expected success')
    expect(new TextEncoder().encode(JSON.stringify(result.envelope.data)).byteLength).toBeLessThanOrEqual(262_144)
    expect(result.envelope.warnings).toContainEqual(expect.objectContaining({
      code: 'TRUNCATED',
      details: expect.objectContaining({ max_bytes: 262_144 }),
    }))
  })

  it('bounds structure Data and adds the dedicated Warning', async () => {
    const maxBytes = 1024
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-08-17' },
      { fetch: fixtureFetch(), maxBytes },
    )

    if (!result.envelope.ok) throw new Error('expected success')
    expect(new TextEncoder().encode(JSON.stringify(result.envelope.data)).byteLength).toBeLessThanOrEqual(maxBytes)
    expect(result.envelope.warnings).toContainEqual(expect.objectContaining({
      code: 'TRUNCATED',
      message: expect.stringContaining('--max-bytes'),
      details: expect.objectContaining({
        max_bytes: maxBytes,
        original_bytes: expect.any(Number),
      }),
    }))
  })

  it('adds no truncation Warning when an explicit larger bound fits the Data', async () => {
    const result = await runOperation(
      structure,
      { title: '32', date: '2026-08-17' },
      { fetch: fixtureFetch(), maxBytes: 2_000_000 },
    )

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.warnings.some(warning => warning.code === 'TRUNCATED')).toBe(false)
    expect(result.envelope.data).toEqual(loadFixture('structure-32').body)
  })

  it('never bounds an introspect operation', async () => {
    const result = await runOperation(capabilities, {}, { maxBytes: 1 })

    if (!result.envelope.ok) throw new Error('expected success')
    expect(result.envelope.warnings.some(warning => warning.code === 'TRUNCATED')).toBe(false)
    expect(result.envelope.data).toEqual(JSON.parse(result.raw!))
  })

  it('does not alter read Raw output at a tiny bound', async () => {
    const fixture = loadFixture('read-32-2002-14')
    const result = await runOperation(
      read,
      { title: '32', part: '2002', section: '2002.14', date: '2026-08-17', xml: true },
      { fetch: fixtureFetch(), maxBytes: 1 },
    )

    expect(result.raw).toBe(fixture.body)
  })

  it('reports an unparseable CLI bound as a USAGE Error code at exit code 2', () => {
    const result = spawnSync(
      'node',
      ['--import', 'tsx', 'src/cli.ts', 'capabilities', '--max-bytes', 'not-a-number'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    const envelope = JSON.parse(result.stdout) as { ok: boolean; error: { code: string } }

    expect(result.status).toBe(2)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('USAGE')
    expect(result.stderr).toContain('error [USAGE]')
  })
})
