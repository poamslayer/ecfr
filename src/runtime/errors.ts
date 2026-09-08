import {
  errorCodes,
  retryableCodes,
  type CliErrorBody,
  type ErrorCode,
} from '../schema/types.js'

const remediations: Record<ErrorCode, string> = {
  USAGE: 'Run `ecfr --help` to review valid operations and flags.',
  NOT_FOUND: 'Run `ecfr titles` to list valid title numbers.',
  RATE_LIMITED: 'Run the same `ecfr` command again after waiting a moment.',
  UPSTREAM_UNAVAILABLE: 'Run the same `ecfr` command again later.',
  NETWORK: 'Check your network connection, then run the same `ecfr` command again.',
  TIMEOUT: 'Run the same `ecfr` command again; narrow the request if it times out repeatedly.',
  UPSTREAM_ERROR: 'Review the params, then run the same `ecfr` command again.',
  INTERNAL: 'Run the same `ecfr` command again with `--json` and report the error.',
}

export interface CliErrorInit {
  status?: number
  retryable?: boolean
  remediation?: string
  details?: Record<string, unknown>
}

export class CliError extends Error {
  readonly code: ErrorCode
  readonly status?: number
  readonly retryable: boolean
  readonly remediation: string
  readonly details: Record<string, unknown>

  constructor(code: ErrorCode, message: string, init: CliErrorInit = {}) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.status = init.status
    this.retryable = init.retryable ?? retryableCodes.has(code)
    this.remediation = init.remediation ?? remediations[code]
    this.details = init.details ?? {}
  }
}

export function toErrorBody(err: unknown): CliErrorBody {
  const cliError = err instanceof CliError
    ? err
    : new CliError('INTERNAL', err instanceof Error ? err.message : 'Unexpected internal failure.', {
        details: err instanceof Error ? { name: err.name } : { value: String(err) },
      })

  return {
    code: cliError.code,
    message: cliError.message,
    ...(cliError.status === undefined ? {} : { status: cliError.status }),
    retryable: cliError.retryable,
    remediation: cliError.remediation,
    details: cliError.details,
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return (errorCodes as readonly string[]).includes(value)
}
