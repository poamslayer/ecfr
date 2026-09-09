import chalk from 'chalk'
import { z } from 'zod'
import { flagObject } from '../flags.js'
import { defineOperation } from '../types.js'

const inputSchema = flagObject(['title', 'agency', 'page', 'perPage', 'fields']).extend({ query: z.string().min(1) })

const searchResultSchema = z.looseObject({
  hierarchy: z.looseObject({ title: z.string(), section: z.string() }),
  hierarchy_headings: z.looseObject({ title: z.string(), section: z.string() }),
  full_text_excerpt: z.string(),
  score: z.number(),
  starts_on: z.string(),
})

const outputSchema = z.looseObject({
  results: z.array(searchResultSchema),
  meta: z.looseObject({
    current_page: z.number().int(),
    per_page: z.number().int().optional(),
    total_pages: z.number().int(),
    total_count: z.number().int(),
  }),
})

export const search = defineOperation({
  name: 'search',
  kind: 'search',
  summary: 'Search across all CFR text',
  description: 'Searches regulation text, optionally narrowing by CFR title or agency, and returns paginated excerpts.',
  positional: { name: 'query', description: 'Text to search for.', schema: z.string().min(1) },
  flags: ['title', 'agency', 'page', 'perPage', 'fields'],
  input: inputSchema,
  network: 'remote',
  untrusted: ['data.results'],
  request: async input => {
    const query = new URLSearchParams({ query: input.query })
    if (input.title) query.set('hierarchy[title]', input.title)
    if (input.agency) query.set('agency', input.agency)
    if (input.page) query.set('page', String(input.page))
    if (input.perPage) query.set('per_page', String(input.perPage))
    return { path: `/api/search/v1/results?${query}`, accept: 'json', params: input, defaulted: [] }
  },
  output: outputSchema,
  render: data => {
    const { meta, results } = data
    const lines = [chalk.bold(`Found ${meta.total_count} results (page ${meta.current_page}/${meta.total_pages})`), '']
    for (const hit of results) {
      const heading = hit.hierarchy_headings?.section ?? hit.hierarchy?.section ?? ''
      lines.push(chalk.cyan(`${hit.hierarchy.title} CFR § ${hit.hierarchy.section}`) + ` — ${heading}`)
      lines.push(`  "${hit.full_text_excerpt}"`)
      lines.push(`  Score: ${hit.score} | Modified: ${hit.starts_on}`)
      lines.push('')
    }
    return lines.join('\n')
  },
  examples: [
    { command: 'ecfr search CUI', description: 'Search all regulation text' },
    { command: 'ecfr search CUI --title 32 --per-page 5', description: 'Search Title 32 five results at a time' },
  ],
  pagination: {
    read: data => ({
      page: data.meta.current_page,
      per_page: data.meta.per_page ?? 20,
      total: data.meta.total_count,
      total_pages: data.meta.total_pages,
    }),
  },
})
