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
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const positiveInt = z.coerce.number().int().positive()

export const flags = {
  json: {
    name: 'json',
    description: 'Write the JSON envelope to stdout (default when stdout is not a TTY).',
    schema: z.boolean().default(false),
    global: true,
  },
  dryRun: {
    name: 'dry-run',
    description: 'Build the request and return the envelope without contacting ecfr.gov.',
    schema: z.boolean().default(false),
    global: true,
  },
  title: {
    name: 'title',
    value: '<n>',
    description: 'CFR title number.',
    schema: z.string().regex(/^\d{1,2}$/, 'expected a title number 1-50'),
  },
  date: {
    name: 'date',
    value: '<date>',
    description: 'Issue date as YYYY-MM-DD. Defaults to the latest issue date the eCFR publishes for the title.',
    schema: isoDate,
  },
  part: {
    name: 'part',
    value: '<n>',
    description: 'Part number within the title.',
    schema: z.string().min(1),
  },
  section: {
    name: 'section',
    value: '<n>',
    description: 'Section number in full dotted form, e.g. 2002.14.',
    schema: z.string().min(1),
  },
  agency: {
    name: 'agency',
    value: '<slug>',
    description: 'Agency slug from `ecfr agencies`.',
    schema: z.string().min(1),
  },
  page: {
    name: 'page',
    value: '<n>',
    description: 'Page number, starting at 1.',
    schema: positiveInt,
  },
  perPage: {
    name: 'per-page',
    value: '<n>',
    description: 'Results per page.',
    schema: positiveInt,
  },
  filter: {
    name: 'filter',
    value: '<text>',
    description: 'Keep only agencies whose name or short name contains this text.',
    schema: z.string().min(1),
  },
  since: {
    name: 'since',
    value: '<date>',
    description: 'Only changes with an issue date on or after this YYYY-MM-DD.',
    schema: isoDate,
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
