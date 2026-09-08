import chalk from 'chalk'
import Table from 'cli-table3'
import { z } from 'zod'
import { flagObject } from '../flags.js'
import { defineOperation } from '../types.js'

const agencySchema = z.looseObject({
  name: z.string(),
  short_name: z.string().nullable().optional(),
  slug: z.string(),
  cfr_references: z.array(z.looseObject({ title: z.number() })),
  children: z.array(z.unknown()),
})

export const agencies = defineOperation({
  name: 'agencies',
  kind: 'list',
  summary: 'List all CFR agencies',
  description: 'Lists agencies represented in the eCFR, with an optional case-insensitive filter over each agency name and short name.',
  flags: ['filter'],
  input: flagObject(['filter']),
  network: 'remote',
  request: async input => ({
    path: '/api/admin/v1/agencies.json',
    accept: 'json',
    params: input,
    defaulted: [],
  }),
  transform: (res, input) => {
    const body = res.body as { agencies: z.output<typeof agencySchema>[] }
    const total = body.agencies.length
    const agencies = input.filter
      ? body.agencies.filter(agency => {
          const term = input.filter!.toLowerCase()
          return agency.name.toLowerCase().includes(term) || (agency.short_name ?? '').toLowerCase().includes(term)
        })
      : body.agencies
    return { total, matched: agencies.length, agencies }
  },
  output: z.looseObject({
    total: z.number().int(),
    matched: z.number().int(),
    agencies: z.array(agencySchema),
  }),
  render: data => {
    const table = new Table({
      head: [chalk.bold('Agency'), chalk.bold('Short Name'), chalk.bold('Slug'), chalk.bold('CFR Titles')],
      colWidths: [45, 15, 30, 15],
    })
    for (const agency of data.agencies) {
      table.push([
        agency.name,
        agency.short_name ?? '—',
        agency.slug,
        agency.cfr_references.map(reference => reference.title).join(', ') || '—',
      ])
    }
    return table.toString()
  },
  examples: [
    { command: 'ecfr agencies', description: 'List every agency' },
    { command: 'ecfr agencies --filter defense', description: 'Keep matching agencies' },
  ],
})
