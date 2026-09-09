import chalk from 'chalk'
import Table from 'cli-table3'
import { z } from 'zod'
import { flagObject, flags } from '../flags.js'
import { defineOperation } from '../types.js'

const contentVersionSchema = z.looseObject({
  date: z.string(),
  amendment_date: z.string().nullable().optional(),
  identifier: z.string(),
  name: z.string(),
  part: z.string().nullable().optional(),
  substantive: z.boolean(),
})

export const changes = defineOperation({
  name: 'changes',
  kind: 'list',
  summary: 'Track regulation amendments for a title',
  description: 'Lists content versions for one CFR title, optionally narrowed by part, section, or earliest issue date.',
  positional: { name: 'title', description: 'CFR title number.', schema: flags.title.schema },
  flags: ['part', 'section', 'since', 'fields'],
  input: flagObject(['part', 'section', 'since', 'fields']).extend({ title: flags.title.schema }),
  network: 'remote',
  titleScoped: true,
  request: async input => {
    const query = new URLSearchParams()
    if (input.part) query.set('part', input.part)
    if (input.section) query.set('section', input.section)
    if (input.since) query.set('issue_date[gte]', input.since)
    const suffix = query.size ? `?${query}` : ''
    return { path: `/api/versioner/v1/versions/title-${input.title}${suffix}`, accept: 'json', params: input, defaulted: [] }
  },
  output: z.looseObject({ content_versions: z.array(contentVersionSchema) }),
  render: data => {
    const table = new Table({
      head: [chalk.bold('Date'), chalk.bold('Amendment'), chalk.bold('Name'), chalk.bold('Part'), chalk.bold('Substantive')],
      colWidths: [14, 14, 40, 10, 14],
    })
    for (const version of data.content_versions) {
      table.push([
        version.date,
        version.amendment_date ?? '—',
        version.name,
        version.part ?? '—',
        version.substantive ? chalk.green('yes') : 'no',
      ])
    }
    return table.toString()
  },
  examples: [
    { command: 'ecfr changes 32', description: 'List changes for Title 32' },
    { command: 'ecfr changes 32 --part 2002 --since 2025-01-01', description: 'Narrow changes by part and issue date' },
  ],
})
