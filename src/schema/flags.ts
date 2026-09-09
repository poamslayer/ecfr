/**
 * Shared flag registry. One spelling, one description, one type per flag.
 * Ops reference flags by key; nothing declares a flag inline.
 */
import { z } from 'zod'

export interface FlagDef {
  /** Commander long name without dashes, e.g. `per-page`. */
  name: string
  /** Placeholder for the value, omitted for booleans. */
  value?: string
  description: string
  schema: z.ZodType
  /** Registered on the root and on every command. */
  global?: boolean
  /** Argument-specific Remediation for a rejected value. */
  remediation?: string
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const positiveInt = z.coerce.number().int().positive()
const identifier = (name: 'part' | 'section') => z.string()
  .min(1, `Pass a non-empty ${name} identifier.`)
  .max(64, `Pass a ${name} identifier no longer than 64 characters.`)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9.\-()]*$/,
    `Pass a ${name} identifier that starts with a letter or number and contains only letters, numbers, dots, hyphens, or parentheses.`,
  )
  .refine(value => !value.includes('..'), `Pass a single ${name} identifier without the traversal sequence "..".`)

export const flags = {
  json: {
    name: 'json',
    description: 'Write the JSON envelope to stdout. Alias for --output json; retained for compatibility.',
    schema: z.boolean().default(false),
    global: true,
  },
  output: {
    name: 'output',
    value: '<format>',
    description: 'Output format: "json" for the envelope, "text" for human-readable rendering. Defaults to json. Overrides --json; falls back to the ECFR_OUTPUT environment variable.',
    schema: z.enum(['json', 'text']),
    global: true,
  },
  dryRun: {
    name: 'dry-run',
    description: 'Resolve the request and return the envelope without fetching the data. Only the small title list is read, to resolve a defaulted date.',
    schema: z.boolean().default(false),
    global: true,
  },
  maxBytes: {
    name: 'max-bytes',
    value: '<n>',
    description: 'Maximum serialized size of "data" in bytes before the response is truncated with a warning. 0 disables the bound.',
    schema: z.coerce.number().int().nonnegative().default(262144),
    global: true,
  },
  title: {
    name: 'title',
    value: '<n>',
    description: 'CFR title number.',
    schema: z.string().regex(/^\d+$/, 'expected a numeric CFR title'),
    remediation: 'Run `ecfr titles` to list valid title numbers.',
  },
  date: {
    name: 'date',
    value: '<date>',
    description: 'Issue date as YYYY-MM-DD.',
    schema: isoDate,
    remediation: 'Pass the issue date as YYYY-MM-DD.',
  },
  part: {
    name: 'part',
    value: '<n>',
    description: 'Part number within the title.',
    schema: identifier('part'),
    remediation: 'Run `ecfr structure <title>` to list the parts in a title.',
  },
  section: {
    name: 'section',
    value: '<n>',
    description: 'Section number in full dotted form, e.g. 2002.14.',
    schema: identifier('section'),
    remediation: 'Pass the section in full dotted form, such as `--section 2002.14`. Run `ecfr structure <title>` to list sections.',
  },
  agency: {
    name: 'agency',
    value: '<slug>',
    description: 'Agency slug from `ecfr agencies`.',
    schema: z.string().min(1),
    remediation: 'Run `ecfr agencies` and pass an agency slug with `--agency`.',
  },
  page: {
    name: 'page',
    value: '<n>',
    description: 'Page number, starting at 1.',
    schema: positiveInt,
    remediation: 'Pass `--page` as a positive integer starting at 1.',
  },
  perPage: {
    name: 'per-page',
    value: '<n>',
    description: 'Results per page.',
    schema: positiveInt,
    remediation: 'Pass `--per-page` as a positive integer.',
  },
  filter: {
    name: 'filter',
    value: '<text>',
    description: 'Keep only agencies whose name or short name contains this text.',
    schema: z.string().min(1),
    remediation: 'Pass non-empty text to `--filter`.',
  },
  since: {
    name: 'since',
    value: '<date>',
    description: 'Only changes with an issue date on or after this YYYY-MM-DD.',
    schema: isoDate,
    remediation: 'Pass `--since` as YYYY-MM-DD.',
  },
  xml: {
    name: 'xml',
    description: 'Write the upstream XML to stdout unchanged instead of the envelope.',
    schema: z.boolean().default(false),
  },
} as const satisfies Record<string, FlagDef>

export type FlagKey = keyof typeof flags

export const globalFlagKeys = (Object.keys(flags) as FlagKey[]).filter(k => (flags[k] as FlagDef).global)

/** Zod object of the named op flags, every one optional. */
export function flagObject<K extends FlagKey>(keys: readonly K[]) {
  const shape = {} as { [P in K]: z.ZodOptional<(typeof flags)[P]['schema']> }
  for (const k of keys) {
    shape[k] = (flags[k].schema as (typeof flags)[K]['schema']).optional() as never
  }
  return z.object(shape)
}

/** Commander option spec, e.g. `--per-page <n>`. */
export function optionSpec(key: FlagKey): string {
  const f = flags[key] as FlagDef
  return f.value ? `--${f.name} ${f.value}` : `--${f.name}`
}

export function remediationFor(field: unknown): string | undefined {
  if (typeof field !== 'string' || !(field in flags)) return undefined
  return (flags[field as FlagKey] as FlagDef).remediation
}
