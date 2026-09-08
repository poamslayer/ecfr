import packageJson from '../../package.json'
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

export function failure(operation: string, error: CliErrorBody): ErrorEnvelope {
  return {
    ok: false,
    version: packageJson.version,
    operation,
    error,
  }
}
