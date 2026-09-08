import { flags } from '../schema/flags.js'
import { policy } from '../schema/policy.js'
import { exitCodes, type AnyOperation, type Currency, type Pagination, type RunResult, type Warning } from '../schema/types.js'
import { fetchUpstream, type FetchDeps } from './api.js'
import { makeCurrencyLookup } from './currency.js'
import { CliError, toErrorBody } from './errors.js'
import { failure, success } from './envelope.js'

export interface RunContextOptions extends FetchDeps {
  dryRun?: boolean
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
  const parsed = op.input.safeParse(rawInput)
  if (!parsed.success) {
    const error = new CliError('USAGE', `Invalid params for ${op.name}.`, {
      remediation: `Run \`ecfr ${op.name} --help\`.`,
      details: { issues: parsed.error.issues },
    })
    return {
      envelope: failure(op.name, toErrorBody(error)),
      exit_code: exitCodes.USAGE,
    }
  }

  const input = parsed.data
  const requestFetch = (req: Parameters<typeof fetchUpstream>[0]) => fetchUpstream(req, ctxOptions)
  const ctx = { currency: makeCurrencyLookup(requestFetch) }

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
      const envelope = success({
        operation: op.name,
        params: input as Record<string, unknown>,
        defaulted: [],
        warnings,
        source: null,
        dry_run: false,
        data,
      })
      return {
        envelope,
        exit_code: exitCodes.OK,
        ...(op.rawOutput === 'json' ? { raw: JSON.stringify(data, null, 2) } : {}),
      }
    }

    const request = await op.request!(input, ctx)
    const params = request.params as Record<string, unknown>
    const requestUrl = new URL(request.path, policy.base_url).toString()
    if (ctxOptions.dryRun) {
      const currency = await resolveCurrency(op, params, ctx)
      return {
        envelope: success({
          operation: op.name,
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
    const envelope = success({
      operation: op.name,
      params,
      defaulted: request.defaulted,
      warnings,
      source: { url: res.url, fetched_at: res.fetched_at },
      ...(currency === undefined ? {} : { currency }),
      ...(pagination === undefined ? {} : { pagination }),
      dry_run: false,
      data,
    })

    const raw = op.rawOutput === 'xml' && params.xml === true
      ? String(res.body)
      : op.rawOutput === 'json'
        ? JSON.stringify(data, null, 2)
        : undefined
    return { envelope, exit_code: exitCodes.OK, ...(raw === undefined ? {} : { raw }) }
  } catch (err) {
    const error = toErrorBody(err)
    return {
      envelope: failure(op.name, error),
      exit_code: exitCodes[error.code],
    }
  }
}
