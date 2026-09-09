import { describe, expect, it } from 'vitest'
import { runOperation } from '../src/runtime/run.js'
import { capabilities } from '../src/schema/ops/capabilities.js'
import { read } from '../src/schema/ops/read.js'
import { titles } from '../src/schema/ops/titles.js'
import { fixtureFetch } from './helpers/fetch-stub.js'

/**
 * The retrofit's central promise is that the released surface is additive-only: no command,
 * flag, envelope field, error code, or exit code that shipped in 0.2.0 was renamed or removed,
 * because agents store invocations in skill files and replay them.
 *
 * These lists are the 0.2.0 contract, taken from `docs/capabilities.json` at commit 2248e32.
 * They are frozen history. Nothing may ever be deleted from them; a later release may only
 * add alongside. A failure here means a stored agent invocation just broke.
 */
const released = {
  commands: ['agencies', 'capabilities', 'changes', 'corrections', 'counts', 'read', 'search', 'structure', 'titles'],
  globalFlags: ['--dry-run', '--json'],
  operationFlags: ['--agency', '--date', '--filter', '--page', '--part', '--per-page', '--section', '--since', '--title', '--xml'],
  errorCodes: ['USAGE', 'NOT_FOUND', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE', 'NETWORK', 'TIMEOUT', 'UPSTREAM_ERROR', 'INTERNAL'],
  exitCodes: [0, 1, 2, 3, 4],
  successEnvelopeKeys: ['ok', 'version', 'operation', 'params', 'defaulted', 'warnings', 'source', 'dry_run', 'data'],
  errorKeys: ['code', 'message', 'retryable', 'remediation', 'details'],
} as const

async function contract(): Promise<Record<string, never> & Record<string, unknown>> {
  const result = await runOperation(capabilities, {})
  if (!result.envelope.ok) throw new Error('capabilities failed')
  return result.envelope.data as Record<string, unknown>
}

describe('the 0.2.0 released surface still exists', () => {
  it('every released command is still present', async () => {
    const data = await contract()
    const names = (data.operations as { name: string }[]).map(op => op.name)
    for (const command of released.commands) expect(names).toContain(command)
  })

  it('every released global flag is still present', async () => {
    const data = await contract()
    const names = (data.global_flags as { name: string }[]).map(flag => flag.name)
    for (const flag of released.globalFlags) expect(names).toContain(flag)
  })

  it('every released operation flag is still present on some operation', async () => {
    const data = await contract()
    const names = new Set(
      (data.operations as { flags: { name: string }[] }[]).flatMap(op => op.flags.map(flag => flag.name)),
    )
    for (const flag of released.operationFlags) expect([...names]).toContain(flag)
  })

  it('every released error code and exit code is still present', async () => {
    const data = await contract()
    for (const code of released.errorCodes) expect(data.error_codes as string[]).toContain(code)
    const exits = (data.exit_codes as { exit: number }[]).map(row => row.exit)
    for (const exit of released.exitCodes) expect(exits).toContain(exit)
  })

  it('every released success envelope field is still present', async () => {
    const result = await runOperation(titles, {}, { fetch: fixtureFetch() })
    if (!result.envelope.ok) throw new Error('expected success')
    for (const key of released.successEnvelopeKeys) {
      expect(Object.keys(result.envelope)).toContain(key)
    }
  })

  it('every released error field is still present', async () => {
    const result = await runOperation(read, { title: '32', section: '../../etc/passwd' }, { fetch: fixtureFetch() })
    if (result.envelope.ok) throw new Error('expected failure')
    for (const key of released.errorKeys) {
      expect(Object.keys(result.envelope.error)).toContain(key)
    }
  })

  it('the released invocation form still works unchanged', async () => {
    const result = await runOperation(titles, {}, { fetch: fixtureFetch() })
    expect(result.exit_code).toBe(0)
    expect(result.envelope.ok).toBe(true)
  })
})
