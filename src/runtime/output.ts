import chalk from 'chalk'
import { findOperation } from '../schema/index.js'
import type { EnvValues } from '../schema/env.js'
import type { RunResult } from '../schema/types.js'

interface Writable {
  write(chunk: string): unknown
}

export interface OutputOptions {
  output?: unknown
  json: boolean
  pretty?: boolean
  environment?: EnvValues
  isTTY: boolean
  stdout: Writable
  stderr: Writable
}

function line(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

export function writeResult(result: RunResult, options: OutputOptions): void {
  const format = options.output === 'json' || options.output === 'text'
    ? options.output
    : options.json
      ? 'json'
      : options.environment?.output ?? 'json'
  const jsonMode = format === 'json'
  if (!result.envelope.ok) {
    if (jsonMode) options.stdout.write(`${JSON.stringify(result.envelope, null, options.pretty === true ? 2 : undefined)}\n`)
    options.stderr.write(`error [${result.envelope.error.code}]: ${result.envelope.error.message}\n`)
    if (!jsonMode) options.stderr.write(`hint: ${result.envelope.error.remediation}\n`)
    return
  }

  if (result.raw !== undefined) {
    options.stdout.write(result.raw)
    return
  }

  if (jsonMode) {
    options.stdout.write(`${JSON.stringify(result.envelope, null, options.pretty === true ? 2 : undefined)}\n`)
    return
  }

  const envelope = result.envelope
  const op = findOperation(envelope.operation)
  if (op && envelope.data !== null) {
    options.stdout.write(line(op.render(envelope.data, envelope.params)))
  }
  for (const warning of envelope.warnings) {
    options.stderr.write(`${chalk.dim(`warning: ${warning.message}`)}\n`)
  }
  if (envelope.defaulted.length > 0) {
    const values = envelope.defaulted
      .map(key => `${key}=${String(envelope.params[key])}`)
      .join(', ')
    options.stderr.write(`${chalk.dim(`defaulted: ${values}`)}\n`)
  }
}
