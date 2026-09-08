import chalk from 'chalk'
import { z } from 'zod'
import { xmlToText } from '../../xml-parser.js'
import { flagObject, flags } from '../flags.js'
import { defineOperation } from '../types.js'

export const read = defineOperation({
  name: 'read',
  kind: 'get',
  summary: 'Read regulation text for a title',
  description: 'Reads regulation text for one CFR title, optionally narrowed by part or section and served at a requested or defaulted issue date.',
  positional: { name: 'title', description: 'CFR title number.', schema: flags.title.schema },
  flags: ['part', 'section', 'date', 'xml'],
  input: flagObject(['part', 'section', 'date', 'xml']).extend({ title: flags.title.schema }),
  network: 'remote',
  titleScoped: true,
  rawOutput: 'xml',
  request: async (input, ctx) => {
    const date = input.date ?? (await ctx.currency(input.title)).latest_issue_date
    const query = new URLSearchParams()
    if (input.part) query.set('part', input.part)
    if (input.section) query.set('section', input.section)
    const suffix = query.size ? `?${query}` : ''
    const params = { ...input, date }
    if (!params.xml) delete params.xml
    return {
      path: `/api/versioner/v1/full/${date}/title-${input.title}.xml${suffix}`,
      accept: 'xml',
      params,
      defaulted: input.date ? [] : ['date'],
    }
  },
  transform: (res, input) => ({ title: input.title, date: input.date!, content: xmlToText(String(res.body)) }),
  output: z.looseObject({ title: z.string(), date: z.iso.date(), content: z.string() }),
  render: data => `${chalk.bold(`Title ${data.title} — as of ${data.date}`)}\n\n${data.content}`,
  examples: [
    { command: 'ecfr read 32 --part 2002 --section 2002.14', description: 'Read one section at the latest issue date' },
    { command: 'ecfr read 32 --date 2025-01-01 --xml', description: 'Write historical upstream XML unchanged' },
  ],
})
