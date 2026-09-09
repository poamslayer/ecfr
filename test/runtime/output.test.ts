import { describe, expect, it } from 'vitest'
import { failure, success } from '../../src/runtime/envelope.js'
import { writeResult } from '../../src/runtime/output.js'
import { readEnv } from '../../src/schema/env.js'
import type { RunResult } from '../../src/schema/types.js'

function successfulResult(): RunResult {
  return {
    envelope: success({
      operation: 'titles',
      request_id: 'test-request-id',
      agent: null,
      untrusted: ['data'],
      params: { date: '2026-08-17' },
      defaulted: ['date'],
      warnings: [{ code: 'RETRIED', message: 'succeeded after 2 attempts' }],
      source: null,
      dry_run: false,
      data: {
        titles: [{
          number: 32,
          name: 'National Defense',
          latest_amended_on: '2026-08-17',
          up_to_date_as_of: '2026-08-17',
          reserved: false,
        }],
      },
    }),
    exit_code: 0,
  }
}

function failedResult(): RunResult {
  return {
    envelope: failure('titles', {
      code: 'NOT_FOUND',
      message: 'eCFR API returned 404',
      retryable: false,
      remediation: 'Run `ecfr titles` to list valid title numbers.',
      details: {},
    }, { request_id: 'test-request-id', agent: null }),
    exit_code: 3,
  }
}

function render(
  result: RunResult,
  options: {
    output?: unknown
    json?: boolean
    pretty?: boolean
    isTTY?: boolean
    env?: Record<string, string | undefined>
  } = {},
): { stdout: string; stderr: string } {
  const stdout: string[] = []
  const stderr: string[] = []
  const environment = readEnv(options.env ?? {}, diagnostic => stderr.push(`${diagnostic}\n`))
  writeResult(result, {
    output: options.output,
    json: options.json ?? false,
    pretty: options.pretty ?? false,
    environment,
    isTTY: options.isTTY ?? false,
    stdout: { write: chunk => stdout.push(String(chunk)) },
    stderr: { write: chunk => stderr.push(String(chunk)) },
  })
  return { stdout: stdout.join(''), stderr: stderr.join('') }
}

describe('writeResult', () => {
  it.each(['json', 'text'] as const)('writes identical %s bytes for TTY and non-TTY stdout', output => {
    const tty = render(successfulResult(), { output, isTTY: true })
    const piped = render(successfulResult(), { output, isTTY: false })
    expect(tty.stdout).toBe(piped.stdout)
  })

  it('--output text renders human-readable text', () => {
    const rendered = render(successfulResult(), { output: 'text' })
    expect(rendered.stdout).toContain('National Defense')
    expect(() => JSON.parse(rendered.stdout)).toThrow()
  })

  it('--output json writes the Envelope', () => {
    const rendered = render(successfulResult(), { output: 'json' })
    expect(JSON.parse(rendered.stdout)).toEqual(successfulResult().envelope)
    expect(rendered.stdout).toBe(`${JSON.stringify(successfulResult().envelope)}\n`)
  })

  it('--pretty indents the JSON Envelope without changing its value', () => {
    const compact = render(successfulResult(), { output: 'json' })
    const pretty = render(successfulResult(), { output: 'json', pretty: true })

    expect(pretty.stdout).toBe(`${JSON.stringify(successfulResult().envelope, null, 2)}\n`)
    expect(JSON.parse(pretty.stdout)).toEqual(JSON.parse(compact.stdout))
  })

  it('--json still selects json', () => {
    const rendered = render(successfulResult(), { json: true })
    expect(JSON.parse(rendered.stdout)).toEqual(successfulResult().envelope)
  })

  it('uses ECFR_OUTPUT as a fallback and lets both flags override it', () => {
    const fromEnv = render(successfulResult(), { env: { ECFR_OUTPUT: 'text' } })
    const jsonAlias = render(successfulResult(), { json: true, env: { ECFR_OUTPUT: 'text' } })
    const canonical = render(successfulResult(), { output: 'text', json: true, env: { ECFR_OUTPUT: 'json' } })

    expect(fromEnv.stdout).toContain('National Defense')
    expect(JSON.parse(jsonAlias.stdout)).toEqual(successfulResult().envelope)
    expect(canonical.stdout).toContain('National Defense')
  })

  it('ignores an unparseable ECFR_OUTPUT with a stderr diagnostic and defaults to json', () => {
    const rendered = render(successfulResult(), { env: { ECFR_OUTPUT: 'yaml' } })
    expect(JSON.parse(rendered.stdout)).toEqual(successfulResult().envelope)
    expect(rendered.stderr).toContain('ECFR_OUTPUT')
    expect(rendered.stderr).toContain('ignored')
  })

  it('keeps structured output on stdout and Warning and Defaulted diagnostics on stderr', () => {
    const rendered = render(successfulResult(), { output: 'text' })
    expect(rendered.stdout).toContain('National Defense')
    expect(rendered.stdout).not.toContain('warning:')
    expect(rendered.stdout).not.toContain('defaulted:')
    expect(rendered.stderr).toContain('warning: succeeded after 2 attempts')
    expect(rendered.stderr).toContain('defaulted: date=2026-08-17')
  })

  it('writes an error Envelope to stdout and its diagnostic to stderr in json mode', () => {
    const rendered = render(failedResult(), { output: 'json' })
    expect(JSON.parse(rendered.stdout)).toEqual(failedResult().envelope)
    expect(rendered.stderr).toBe('error [NOT_FOUND]: eCFR API returned 404\n')
  })
})
