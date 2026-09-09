import chalk from 'chalk'
import Table from 'cli-table3'
import { z } from 'zod'
import { defineOperation } from '../types.js'
import { flagObject } from '../flags.js'

const titleSchema = z.looseObject({
  number: z.number().int(),
  name: z.string(),
  latest_amended_on: z.iso.date().nullable().optional(),
  latest_issue_date: z.iso.date().nullable().optional(),
  up_to_date_as_of: z.iso.date().nullable().optional(),
  reserved: z.boolean(),
})

export const titles = defineOperation({
  name: 'titles',
  kind: 'list',
  summary: 'List all CFR titles',
  description:
    'Lists the 50 CFR titles with their number, name, latest amendment date, latest issue date, and the date the eCFR says each is up to date as of. Reserved titles are included in data and hidden in the table.',
  flags: ['fields'],
  input: flagObject(['fields']),
  network: 'remote',
  request: async input => ({
    path: '/api/versioner/v1/titles',
    accept: 'json',
    params: input,
    defaulted: [],
  }),
  output: z.looseObject({
    titles: z.array(titleSchema),
  }),
  render: data => {
    const table = new Table({
      head: [chalk.bold('#'), chalk.bold('Title'), chalk.bold('Last Amended'), chalk.bold('Up To Date As Of')],
      colWidths: [6, 55, 16, 20],
    })
    for (const t of data.titles) {
      if (t.reserved) continue
      table.push([t.number, t.name, t.latest_amended_on ?? '—', t.up_to_date_as_of ?? '—'])
    }
    return table.toString()
  },
  examples: [
    { command: 'ecfr titles', description: 'Table of every title' },
    { command: 'ecfr titles --json', description: 'Envelope with data.titles[]' },
  ],
})
