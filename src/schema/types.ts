/**
 * The contract every surface derives from: operations, the envelope, errors, exit codes.
 * Vocabulary follows CONTEXT.md. Nothing in this file touches the network, stdout, or process.
 */
import { z } from 'zod'
import type { FlagKey } from './flags.js'

// ---------------------------------------------------------------------------
// Contract version
// ---------------------------------------------------------------------------

/**
 * Version of the shape of the contract `capabilities` returns. Bumped when that shape
 * changes — a top-level key added, removed, or re-typed — not when an operation is added,
 * so a caller can tell whether its understanding of the contract is still current.
 */
export const schemaVersion = '1'

// ---------------------------------------------------------------------------
// Error codes and exit codes
// ---------------------------------------------------------------------------

export const errorCodes = [
  'USAGE',
  'NOT_FOUND',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'NETWORK',
  'TIMEOUT',
  'UPSTREAM_ERROR',
  'INTERNAL',
] as const
export type ErrorCode = (typeof errorCodes)[number]

export const exitCodes: Record<ErrorCode | 'OK', number> = {
  OK: 0,
  INTERNAL: 1,
  UPSTREAM_ERROR: 1,
  USAGE: 2,
  NOT_FOUND: 3,
  RATE_LIMITED: 4,
  UPSTREAM_UNAVAILABLE: 4,
  NETWORK: 4,
  TIMEOUT: 4,
}

export const retryableCodes: ReadonlySet<ErrorCode> = new Set([
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'NETWORK',
  'TIMEOUT',
])

/** One row of the exit code table shown by `capabilities`. */
export const exitCodeTable = [
  { exit: 0, codes: ['OK'], when: 'Success, including a dry run.' },
  { exit: 1, codes: ['UPSTREAM_ERROR', 'INTERNAL'], when: 'Unexpected upstream 4xx or an internal failure.' },
  { exit: 2, codes: ['USAGE'], when: 'Bad flags, positionals, or values.' },
  { exit: 3, codes: ['NOT_FOUND'], when: 'ecfr.gov returned 404 for the request.' },
  { exit: 4, codes: ['RATE_LIMITED', 'UPSTREAM_UNAVAILABLE', 'NETWORK', 'TIMEOUT'], when: 'Transient failure after retries were exhausted. Safe to retry later.' },
] as const

// ---------------------------------------------------------------------------
// Envelope pieces (zod so they can be emitted as JSON Schema)
// ---------------------------------------------------------------------------

export const warningSchema = z.object({
  code: z.enum(['RETRIED', 'OUTPUT_SCHEMA_MISMATCH', 'TRUNCATED']),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
}).meta({ id: 'Warning', description: 'Something the caller should react to.' })
export type Warning = z.infer<typeof warningSchema>

export const sourceSchema = z.object({
  url: z.string().describe('Full upstream URL the CLI requested.'),
  fetched_at: z.iso.datetime().nullable().describe('When the response was received. Null on a dry run.'),
}).meta({ id: 'Source' })
export type Source = z.infer<typeof sourceSchema>

export const currencySchema = z.object({
  date: z.iso.date().describe('Issue date the text was served for.'),
  latest_amended_on: z.iso.date().nullable(),
  up_to_date_as_of: z.iso.date().nullable(),
}).meta({ id: 'Currency', description: 'How current the served regulation text is, resolved fresh every run.' })
export type Currency = z.infer<typeof currencySchema>

/** What the currency lookup returns for one title. */
export const titleCurrencySchema = z.object({
  latest_issue_date: z.iso.date(),
  latest_amended_on: z.iso.date().nullable(),
  up_to_date_as_of: z.iso.date().nullable(),
})
export type TitleCurrency = z.infer<typeof titleCurrencySchema>

export const paginationSchema = z.object({
  page: z.number().int(),
  per_page: z.number().int(),
  total: z.number().int(),
  total_pages: z.number().int(),
  next: z.string().nullable().describe('A ready to run command for the next page, or null.'),
}).meta({ id: 'Pagination' })
export type Pagination = z.infer<typeof paginationSchema>

export const errorSchema = z.object({
  code: z.enum(errorCodes),
  message: z.string(),
  status: z.number().int().optional().describe('Upstream HTTP status when there was one.'),
  retryable: z.boolean(),
  remediation: z.string().describe('What to run or change next.'),
  field: z.string().optional().describe('The argument that was wrong, when one argument was.'),
  details: z.record(z.string(), z.unknown()),
}).meta({ id: 'Error' })
export type CliErrorBody = z.infer<typeof errorSchema>

const envelopeBase = {
  version: z.string().describe('CLI version that produced this envelope.'),
  operation: z.string(),
  request_id: z.string().describe('Per-invocation identifier for tracing.'),
  agent: z.string().nullable().describe('Self-reported agent name for tracing, or null.'),
}

export const successEnvelopeSchema = z.object({
  ok: z.literal(true),
  ...envelopeBase,
  target: z.string().describe('Target that served or is described by this envelope.'),
  untrusted: z.array(z.string()).describe('Dot paths naming fields that hold fetched external content.'),
  params: z.record(z.string(), z.unknown()).describe('Effective inputs after defaults.'),
  defaulted: z.array(z.string()).describe('Names of params the CLI filled in.'),
  warnings: z.array(warningSchema),
  source: sourceSchema.nullable().describe('Null for operations that do not touch the network.'),
  currency: currencySchema.optional(),
  pagination: paginationSchema.optional(),
  dry_run: z.boolean(),
  data: z.unknown(),
}).meta({ id: 'SuccessEnvelope' })

export const errorEnvelopeSchema = z.object({
  ok: z.literal(false),
  ...envelopeBase,
  error: errorSchema,
}).meta({ id: 'ErrorEnvelope' })

export const envelopeSchema = z.union([successEnvelopeSchema, errorEnvelopeSchema]).meta({ id: 'Envelope' })

export type SuccessEnvelope<O = unknown> = Omit<z.infer<typeof successEnvelopeSchema>, 'data'> & { data: O | null }
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>
export type Envelope<O = unknown> = SuccessEnvelope<O> | ErrorEnvelope

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type Kind = 'list' | 'get' | 'search' | 'introspect'

/** What an operation asks the runtime to fetch. */
export interface UpstreamRequest {
  /** Path plus query, relative to the base URL. */
  path: string
  accept: 'json' | 'xml'
}

/** What the runtime hands back to `transform`. */
export interface UpstreamResponse {
  body: unknown
  url: string
  fetched_at: string
  content_type: string
  attempts: number
}

/** Services an operation may use while building its request. Implemented by the runtime. */
export interface Ctx {
  /** Fresh per-title currency from ecfr.gov, memoized within one run. */
  currency: (title: string) => Promise<TitleCurrency>
}

export interface RequestPlan<I> extends UpstreamRequest {
  /** Effective params after defaults, reported in the envelope. */
  params: I
  /** Names of params the operation filled in. */
  defaulted: string[]
}

export interface Positional {
  name: string
  description: string
  schema: z.ZodType
  /** Registered as `[name]` rather than `<name>`; the operation must handle its absence. */
  optional?: boolean
}

export interface Example {
  command: string
  description: string
}

export interface Operation<IS extends z.ZodType = z.ZodType, OS extends z.ZodType = z.ZodType> {
  /** Command name as typed, e.g. `read`. */
  name: string
  kind: Kind
  /** One line for help and capabilities. */
  summary: string
  /** A paragraph for docs and the skill. */
  description: string
  positional?: Positional
  /** Keys into the shared flag registry. Global flags are added by the runtime. */
  flags: FlagKey[]
  /** Validates positional plus op flags together. */
  input: IS
  network: 'remote' | 'none'
  /** Dot paths within the Envelope that hold fetched external Content. */
  untrusted?: string[]
  /** Adds `currency` to the envelope, keyed by `params.title`. */
  titleScoped?: boolean
  /** Bypasses the envelope. `xml` only when `input.xml` is set; `json` always. */
  rawOutput?: 'xml' | 'json'
  /** Required when `network` is `remote`. */
  request?: (input: z.output<IS>, ctx: Ctx) => Promise<RequestPlan<z.output<IS>>>
  /** Turns the upstream body into `data`. Identity when omitted. */
  transform?: (res: UpstreamResponse, input: z.output<IS>) => z.output<OS>
  /** For `network: 'none'` ops: produces `data` directly. */
  compute?: (input: z.output<IS>, ctx: Ctx) => Promise<z.output<OS>>
  /** Loose schema of `data`; emitted as JSON Schema. */
  output: OS
  /** Human text for a TTY. */
  render: (data: z.output<OS>, input: z.output<IS>) => string
  examples: Example[]
  pagination?: {
    /** Reads `{ page, per_page, total, total_pages }` from `data`. */
    read: (data: z.output<OS>) => Omit<Pagination, 'next'> | null
  }
}

export type AnyOperation = Operation<z.ZodType, z.ZodType>

/** Identity helper so op files get full inference without annotating generics. */
export function defineOperation<IS extends z.ZodType, OS extends z.ZodType>(op: Operation<IS, OS>): Operation<IS, OS> {
  return op
}

/** Result of running one operation. Only cli.ts turns this into streams and an exit code. */
export interface RunResult<O = unknown> {
  envelope: Envelope<O>
  exit_code: number
  /** Set when the op bypasses the envelope; written to stdout verbatim. */
  raw?: string
}
