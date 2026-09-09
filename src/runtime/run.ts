import { randomUUID } from 'node:crypto'
import { flags, remediationFor } from '../schema/flags.js'
import { policy } from '../schema/policy.js'
import { exitCodes, type AnyOperation, type Currency, type Pagination, type RunResult, type Warning } from '../schema/types.js'
import { fetchUpstream, type FetchDeps } from './api.js'
import { makeCurrencyLookup } from './currency.js'
import { boundData } from './bound.js'
import { CliError, toErrorBody } from './errors.js'
import { failure, success } from './envelope.js'

export interface RunContextOptions extends FetchDeps {
  dryRun?: boolean
  maxBytes?: unknown
}

interface Trace {
  request_id: string
  agent: string | null
}

function untrustedPaths(op: AnyOperation): string[] {
  return op.untrusted ?? (op.network === 'remote' ? ['data'] : [])
}

function failureResult(op: AnyOperation, error: CliError, trace: Trace): RunResult {
  const body = toErrorBody(error)
  return {
    envelope: failure(op.name, body, trace),
    exit_code: exitCodes[body.code],
  }
}

function parseMaxBytes(op: AnyOperation, value: unknown, trace: Trace): number | RunResult {
  const parsed = flags.maxBytes.schema.safeParse(value)
  if (parsed.success) return parsed.data
  const error = new CliError('USAGE', 'Invalid value for --max-bytes.', {
    remediation: `Run \`ecfr ${op.name} --help\`.`,
    field: 'maxBytes',
    details: { issues: parsed.error.issues },
  })
  return failureResult(op, error, trace)
}

function applyBound(op: AnyOperation, data: unknown, maxBytes: number, warnings: Warning[]): unknown {
  if (op.kind === 'introspect') return data
  const bounded = boundData(data, maxBytes)
  if (bounded.truncated) {
    warnings.push({
      code: 'TRUNCATED',
      message: `Data was truncated from ${bounded.original_bytes} to ${bounded.bytes} bytes. Raise or disable the bound with --max-bytes.`,
      details: {
        bytes: bounded.bytes,
        original_bytes: bounded.original_bytes,
        max_bytes: maxBytes,
        dropped: bounded.dropped,
      },
    })
  }
  return bounded.data
}

/**
 * The CLI's own mask syntax, since the upstream API has none: a comma-separated list of
 * top-level field names. Returns undefined when no mask was passed at all.
 */
function parseFieldMask(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined
  return raw.split(',').map(name => name.trim()).filter(name => name.length > 0)
}

function maskUsageError(op: AnyOperation, message: string, remediation: string, details: Record<string, unknown> = {}): CliError {
  return new CliError('USAGE', message, { remediation, field: 'fields', details })
}

/**
 * Keeps the requested top-level keys of Data, in the Data's own key order. Validation is
 * against the Data that actually arrived: the output schemas are loose and one is
 * recursive, so the response itself is the only reliable authority on what a caller may ask for.
 */
function emptyMaskError(op: AnyOperation): CliError {
  return maskUsageError(
    op,
    `--fields for ${op.name} named no field.`,
    `Pass --fields as a comma-separated list of top-level field names, or drop the flag to return every field. Run \`ecfr ${op.name} --help\`.`,
  )
}

function applyFieldMask(op: AnyOperation, data: unknown, names: string[]): Record<string, unknown> {
  if (names.length === 0) throw emptyMaskError(op)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw maskUsageError(
      op,
      `Data for ${op.name} is not an object, so it has no top-level fields to keep.`,
      `Run \`ecfr ${op.name}\` without --fields.`,
    )
  }

  const entries = Object.entries(data as Record<string, unknown>)
  const available = entries.map(([key]) => key)
  const unknown = names.filter(name => !available.includes(name))
  if (unknown.length > 0) {
    throw maskUsageError(
      op,
      `--fields named ${unknown.join(', ')}, which ${op.name} did not return.`,
      `Pass --fields with names this operation returns: ${available.join(', ')}.`,
      { unknown, available },
    )
  }

  const requested = new Set(names)
  return Object.fromEntries(entries.filter(([key]) => requested.has(key)))
}

/** Whether an `untrusted` dot path still resolves in the Data the caller is about to receive. */
function untrustedPathSurvives(path: string, data: unknown): boolean {
  const segments = path.split('.')
  if (segments[0] !== 'data') return true
  let current: unknown = data
  for (const segment of segments.slice(1)) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return false
    if (!Object.hasOwn(current, segment)) return false
    current = (current as Record<string, unknown>)[segment]
  }
  return true
}

function shellQuote(value: unknown): string {
  const text = String(value)
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'"'"'`)}'`
}

function nextCommand(op: AnyOperation, params: Record<string, unknown>, nextPage: number): string {
  const parts = ['ecfr', op.name]
  if (op.positional) parts.push(shellQuote(params[op.positional.name]))
  for (const key of op.flags) {
    const value = key === 'page' ? nextPage : params[key]
    if (value === undefined || value === null || value === false) continue
    const definition = flags[key]
    parts.push(`--${definition.name}`)
    if ('value' in definition && definition.value) parts.push(shellQuote(value))
  }
  return parts.join(' ')
}

function makePagination(op: AnyOperation, data: unknown, params: Record<string, unknown>): Pagination | undefined {
  const read = op.pagination?.read(data)
  if (!read) return undefined
  return {
    ...read,
    per_page: typeof params.perPage === 'number' ? params.perPage : read.per_page,
    next: read.page < read.total_pages ? nextCommand(op, params, read.page + 1) : null,
  }
}

/** Currency for title-scoped operations; the lookup is memoized so this costs nothing after request(). */
async function resolveCurrency(
  op: AnyOperation,
  params: Record<string, unknown>,
  ctx: { currency: (title: string) => Promise<{ latest_issue_date: string; latest_amended_on: string | null; up_to_date_as_of: string | null }> },
): Promise<Currency | undefined> {
  if (!op.titleScoped) return undefined
  const resolved = await ctx.currency(String(params.title))
  return {
    date: typeof params.date === 'string' ? params.date : resolved.latest_issue_date,
    latest_amended_on: resolved.latest_amended_on,
    up_to_date_as_of: resolved.up_to_date_as_of,
  }
}

export async function runOperation(
  op: AnyOperation,
  rawInput: unknown,
  ctxOptions: RunContextOptions = {},
): Promise<RunResult> {
  const trace = {
    request_id: ctxOptions.requestId ?? randomUUID(),
    agent: ctxOptions.agent ?? null,
  }
  const maxBytesResult = parseMaxBytes(op, ctxOptions.maxBytes, trace)
  if (typeof maxBytesResult !== 'number') return maxBytesResult
  const maxBytes = maxBytesResult

  const parsed = op.input.safeParse(rawInput)
  if (!parsed.success) {
    const pathHead = parsed.error.issues[0]?.path[0]
    const field = typeof pathHead === 'string' ? pathHead : undefined
    const error = new CliError('USAGE', `Invalid params for ${op.name}.`, {
      remediation: remediationFor(field) ?? `Run \`ecfr ${op.name} --help\`.`,
      field,
      details: { issues: parsed.error.issues },
    })
    return failureResult(op, error, trace)
  }

  const input = parsed.data

  // A mask that names no field is a pure usage error: it needs no response to detect, so it is
  // rejected before any upstream request. A dry run and a real run therefore agree, and a typo
  // does not cost the caller a full payload first. Unknown names still need the Data to check.
  const declaredMask = parseFieldMask((input as Record<string, unknown>).fields)
  if (declaredMask !== undefined && declaredMask.length === 0) {
    return failureResult(op, emptyMaskError(op), trace)
  }

  const requestFetch = (req: Parameters<typeof fetchUpstream>[0]) => fetchUpstream(req, {
    ...ctxOptions,
    requestId: trace.request_id,
    agent: trace.agent,
  })
  const ctx = { currency: makeCurrencyLookup(requestFetch) }
  let effectiveParams = input as Record<string, unknown>

  try {
    if (op.network === 'none') {
      const data = await op.compute!(input, ctx)
      const warnings: Warning[] = []
      const outputCheck = op.output.safeParse(data)
      if (!outputCheck.success) {
        warnings.push({
          code: 'OUTPUT_SCHEMA_MISMATCH',
          message: `Data for ${op.name} did not match its output schema.`,
          details: { issues: outputCheck.error.issues.slice(0, 5) },
        })
      }
      const mask = declaredMask
      const maskedData = mask === undefined ? data : applyFieldMask(op, data, mask)
      const untrusted = mask === undefined
        ? untrustedPaths(op)
        : untrustedPaths(op).filter(path => untrustedPathSurvives(path, maskedData))
      const boundedData = applyBound(op, maskedData, maxBytes, warnings)
      const envelope = success({
        operation: op.name,
        ...trace,
        untrusted,
        params: input as Record<string, unknown>,
        defaulted: [],
        warnings,
        source: null,
        dry_run: false,
        data: boundedData,
      })
      return {
        envelope,
        exit_code: exitCodes.OK,
        ...(op.rawOutput === 'json' ? { raw: JSON.stringify(data, null, 2) } : {}),
      }
    }

    const request = await op.request!(input, ctx)
    const params = request.params as Record<string, unknown>
    effectiveParams = params
    const requestUrl = new URL(request.path, policy.base_url).toString()
    if (ctxOptions.dryRun) {
      const currency = await resolveCurrency(op, params, ctx)
      return {
        envelope: success({
          operation: op.name,
          ...trace,
          untrusted: untrustedPaths(op),
          params,
          defaulted: request.defaulted,
          warnings: [],
          source: { url: requestUrl, fetched_at: null },
          ...(currency === undefined ? {} : { currency }),
          dry_run: true,
          data: null,
        }),
        exit_code: exitCodes.OK,
      }
    }

    const res = await requestFetch(request)
    const data = op.transform ? op.transform(res, request.params) : res.body
    const warnings: Warning[] = []
    const outputCheck = op.output.safeParse(data)
    if (!outputCheck.success) {
      warnings.push({
        code: 'OUTPUT_SCHEMA_MISMATCH',
        message: `Data for ${op.name} did not match its output schema.`,
        details: { issues: outputCheck.error.issues.slice(0, 5) },
      })
    }
    if (res.attempts > 1) {
      warnings.push({ code: 'RETRIED', message: `succeeded after ${res.attempts} attempts` })
    }

    const currency = await resolveCurrency(op, params, ctx)

    const pagination = makePagination(op, data, params)
    const mask = declaredMask
    const maskedData = mask === undefined ? data : applyFieldMask(op, data, mask)
    const untrusted = mask === undefined
      ? untrustedPaths(op)
      : untrustedPaths(op).filter(path => untrustedPathSurvives(path, maskedData))
    const boundedData = applyBound(op, maskedData, maxBytes, warnings)
    const envelope = success({
      operation: op.name,
      ...trace,
      untrusted,
      params,
      defaulted: request.defaulted,
      warnings,
      source: { url: res.url, fetched_at: res.fetched_at },
      ...(currency === undefined ? {} : { currency }),
      ...(pagination === undefined ? {} : { pagination }),
      dry_run: false,
      data: boundedData,
    })

    const raw = op.rawOutput === 'xml' && params.xml === true
      ? String(res.body)
      : op.rawOutput === 'json'
        ? JSON.stringify(data, null, 2)
        : undefined
    return { envelope, exit_code: exitCodes.OK, ...(raw === undefined ? {} : { raw }) }
  } catch (err) {
    let error = toErrorBody(err)
    if (error.code === 'NOT_FOUND') {
      const field = effectiveParams.section !== undefined
        ? 'section'
        : effectiveParams.part !== undefined
          ? 'part'
          : effectiveParams.title !== undefined
            ? 'title'
            : undefined
      const remediation = field === undefined ? flags.title.remediation : remediationFor(field)!
      error = { ...error, ...(field === undefined ? {} : { field }), remediation }
    }
    return {
      envelope: failure(op.name, error, trace),
      exit_code: exitCodes[error.code],
    }
  }
}
