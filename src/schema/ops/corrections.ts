import chalk from 'chalk'
import Table from 'cli-table3'
import { z } from 'zod'
import { flagObject } from '../flags.js'
import { defineOperation } from '../types.js'

const correctionSchema = z.looseObject({
  fr_citation: z.string(),
  corrective_action: z.string(),
  error_corrected: z.string().nullable().optional(),
  error_occurred: z.string().nullable().optional(),
  title: z.number(),
  cfr_references: z.array(z.looseObject({ cfr_reference: z.string() })),
})

export const corrections = defineOperation({
  name: 'corrections',
  kind: 'list',
  summary: 'View CFR corrections and errata',
  description: 'Lists eCFR corrections and errata, optionally filtered by CFR title number and date.',
  flags: ['title', 'date'],
  input: flagObject(['title', 'date']),
  network: 'remote',
  request: async input => {
    const query = new URLSearchParams()
    if (input.title) query.set('title', input.title)
    if (input.date) query.set('date', input.date)
    const suffix = query.size ? `?${query}` : ''
    return { path: `/api/admin/v1/corrections.json${suffix}`, accept: 'json', params: input, defaulted: [] }
  },
  output: z.looseObject({ ecfr_corrections: z.array(correctionSchema) }),
  render: data => {
    const table = new Table({
      head: [chalk.bold('FR Citation'), chalk.bold('Title'), chalk.bold('CFR Reference'), chalk.bold('Action'), chalk.bold('Corrected')],
      colWidths: [18, 8, 22, 28, 14],
    })
    for (const correction of data.ecfr_corrections) {
      const references = correction.cfr_references?.map(reference => reference.cfr_reference).join(', ') ?? '—'
      table.push([
        correction.fr_citation,
        correction.title,
        references,
        correction.corrective_action,
        correction.error_corrected ?? '—',
      ])
    }
    return table.toString()
  },
  examples: [
    { command: 'ecfr corrections', description: 'List all corrections' },
    { command: 'ecfr corrections --title 32 --date 2025-01-01', description: 'Filter corrections by title and date' },
  ],
})
