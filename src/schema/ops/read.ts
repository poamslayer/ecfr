import chalk from 'chalk'
import { z } from 'zod'
import { CliError } from '../../runtime/errors.js'
import { parseCitation } from '../citation.js'
import { parseRegulation } from '../../xml-parser.js'
import { flagObject, flags } from '../flags.js'
import { defineOperation } from '../types.js'

const sectionSchema = z.object({
  number: z.string().nullable(),
  citation: z.string().nullable(),
  alternate_reference: z.string().nullable(),
  federal_register_citation: z.string().nullable(),
}).meta({ id: 'SectionMeta' })

/**
 * The positional is either a bare CFR title number, exactly as it has always been, or a
 * citation. It is deliberately unvalidated here: every rejection on this argument goes through
 * `resolveTarget`, so one place decides what a positional may be and one place writes the
 * Remediation for it.
 */
const targetSchema = z.string()

const inputSchema = flagObject(['part', 'section', 'date', 'xml', 'fields'])
  .extend({ title: targetSchema })

type ReadInput = z.output<typeof inputSchema>

const bareTitle = /^\d+$/

interface ResolvedTarget {
  title: string
  part?: string
  section?: string
  /** Absent when the caller passed a bare title number. */
  citation?: string
}

function usage(message: string, remediation: string, details: Record<string, unknown>): CliError {
  return new CliError('USAGE', message, { field: 'title', remediation, details })
}

/**
 * A part or section that arrived through a citation goes through the same hardened identifier
 * schema as one that arrived through `--part` or `--section`. The citation path must not
 * become a way around input hardening.
 */
function harden(kind: 'part' | 'section', value: string, citation: string): string {
  const parsed = flags[kind].schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw usage(
    `The citation "${citation}" resolved to a ${kind} that is not a valid identifier.`,
    flags[kind].remediation,
    { citation, [kind]: value, issues: parsed.error.issues },
  )
}

function resolveTarget(raw: string): ResolvedTarget {
  if (bareTitle.test(raw)) return { title: raw }
  const parsed = parseCitation(raw)
  if (!parsed.ok) throw usage(parsed.reason, parsed.remediation, { citation: raw })
  const { title, part, section, citation } = parsed.value
  return {
    title,
    ...(part === undefined ? {} : { part: harden('part', part, citation) }),
    ...(section === undefined ? {} : { section: harden('section', section, citation) }),
    citation,
  }
}

/**
 * Reject-only, never a silent preference: a citation already carries the part and section, so
 * combining it with the flags that carry them is a caller mistake worth naming.
 */
function rejectConflictingFlags(input: ReadInput, target: ResolvedTarget): void {
  const conflicting = (['part', 'section'] as const).filter(key => input[key] !== undefined)
  if (conflicting.length === 0) return
  const named = conflicting.map(key => `--${key}`)
  throw new CliError('USAGE', `The citation "${target.citation}" cannot be combined with ${named.join(' or ')}.`, {
    field: conflicting[0],
    remediation: `The citation already carries the part and section. Drop ${named.join(' and ')}, or pass the bare title number with the flags, as in \`ecfr read ${target.title} --part 2002 --section 2002.14\`.`,
    details: { citation: target.citation, conflicting: named },
  })
}

export const read = defineOperation({
  name: 'read',
  kind: 'get',
  summary: 'Read regulation text for a title',
  description: 'Reads regulation text for one CFR title, optionally narrowed by part or section and served at a requested or defaulted issue date. The positional is either a bare CFR title number, as in `ecfr read 32 --part 2002 --section 2002.14`, or a citation in one of two forms, matched case-insensitively: `<title> CFR [§] <section>`, such as "32 CFR 2002.14", "32 CFR § 2002.14", or "48 CFR 252.204-7012"; and `<title> CFR part <part>`, such as "32 CFR part 2002". A citation derives the part from everything before the first dot of the section, reports the resolved title, part, and section in `params` alongside the citation text verbatim in `params.citation`, and cannot be combined with `--part` or `--section`. Because the eCFR API addresses parts and sections only, a subpart or appendix qualifier such as "32 CFR 2002.14 Subpart B", a section range such as "32 CFR 2002.14-2002.16", and an alternate reference such as "DFARS 252.204-7012" are each rejected with a USAGE error naming the part-level command to run instead.',
  positional: {
    name: 'title',
    description: 'CFR title number, or a citation such as "32 CFR 2002.14" or "32 CFR part 2002".',
    schema: targetSchema,
  },
  flags: ['part', 'section', 'date', 'xml', 'fields'],
  input: inputSchema,
  network: 'remote',
  untrusted: ['data.content', 'data.sections'],
  titleScoped: true,
  rawOutput: 'xml',
  request: async (input, ctx) => {
    const target = resolveTarget(input.title)
    if (target.citation !== undefined) rejectConflictingFlags(input, target)
    const part = target.citation === undefined ? input.part : target.part
    const section = target.citation === undefined ? input.section : target.section
    const date = input.date ?? (await ctx.currency(target.title)).latest_issue_date
    const query = new URLSearchParams()
    if (part) query.set('part', part)
    if (section) query.set('section', section)
    const suffix = query.size ? `?${query}` : ''
    const params: ReadInput & { citation?: string } = {
      ...input,
      title: target.title,
      ...(part === undefined ? {} : { part }),
      ...(section === undefined ? {} : { section }),
      date,
      ...(target.citation === undefined ? {} : { citation: target.citation }),
    }
    if (!params.xml) delete params.xml
    return {
      path: `/api/versioner/v1/full/${date}/title-${target.title}.xml${suffix}`,
      accept: 'xml',
      params,
      defaulted: input.date ? [] : ['date'],
    }
  },
  transform: (res, input) => {
    const regulation = parseRegulation(String(res.body))
    return { title: input.title, date: input.date!, ...regulation }
  },
  output: z.looseObject({
    title: z.string(),
    date: z.iso.date(),
    content: z.string(),
    sections: z.array(sectionSchema),
  }),
  render: data => {
    const citations = data.sections.flatMap(section => section.citation ? [section.citation] : [])
    const citationLine = citations.length > 0 ? `\n${citations.join('\n')}` : ''
    return `${chalk.bold(`Title ${data.title} — as of ${data.date}`)}${citationLine}\n\n${data.content}`
  },
  examples: [
    { command: 'ecfr read 32 --part 2002 --section 2002.14', description: 'Read one section at the latest issue date' },
    { command: 'ecfr read 32 --date 2025-01-01 --xml', description: 'Write historical upstream XML unchanged' },
    { command: 'ecfr read "32 CFR 2002.14"', description: 'Read a section by citation' },
  ],
})
