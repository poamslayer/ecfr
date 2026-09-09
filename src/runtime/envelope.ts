import packageJson from '../../package.json'
import { defaultTarget } from '../schema/policy.js'
import type {
  CliErrorBody,
  Currency,
  ErrorEnvelope,
  Pagination,
  Source,
  SuccessEnvelope,
  Warning,
} from '../schema/types.js'

interface SuccessInput<O> {
  operation: string
  request_id: string
  agent: string | null
  untrusted: string[]
  params: Record<string, unknown>
  defaulted: string[]
  warnings: Warning[]
  source: Source | null
  currency?: Currency
  pagination?: Pagination
  dry_run: boolean
  data: O | null
}

export function success<O>(input: SuccessInput<O>): SuccessEnvelope<O> {
  return {
    ok: true,
    version: packageJson.version,
    operation: input.operation,
    request_id: input.request_id,
    agent: input.agent,
    target: defaultTarget,
    untrusted: input.untrusted,
    params: input.params,
    defaulted: input.defaulted,
    warnings: input.warnings,
    source: input.source,
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    ...(input.pagination === undefined ? {} : { pagination: input.pagination }),
    dry_run: input.dry_run,
    data: input.data,
  }
}

export function failure(
  operation: string,
  error: CliErrorBody,
  trace: { request_id: string; agent: string | null },
): ErrorEnvelope {
  return {
    ok: false,
    version: packageJson.version,
    operation,
    request_id: trace.request_id,
    agent: trace.agent,
    error,
  }
}
