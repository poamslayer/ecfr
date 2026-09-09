import chalk from 'chalk'
import { z } from 'zod'
import { flagObject } from '../flags.js'
import { defineOperation } from '../types.js'

interface CountNode {
  level: string
  hierarchy: string | null
  hierarchy_heading: string | null
  heading: string | null
  count: number
  max_score: number
  children?: CountNode[]
}

const countNodeSchema: z.ZodType<CountNode> = z.lazy(() => z.looseObject({
  level: z.string(),
  hierarchy: z.string().nullable(),
  hierarchy_heading: z.string().nullable(),
  heading: z.string().nullable(),
  count: z.number(),
  max_score: z.number(),
  children: z.array(countNodeSchema).optional(),
}))

function renderCountTree(nodes: CountNode[], lines: string[], depth: number): void {
  const indent = '  '.repeat(depth)
  for (const node of nodes) {
    const label = node.heading
      ? `${node.hierarchy_heading ?? node.hierarchy ?? node.level} — ${node.heading}`
      : (node.hierarchy_heading ?? node.hierarchy ?? node.level)
    lines.push(`${indent}${label}: ${chalk.yellow(String(node.count))}`)
    if (node.children?.length) renderCountTree(node.children, lines, depth + 1)
  }
}

export const counts = defineOperation({
  name: 'counts',
  kind: 'search',
  summary: 'Search result counts by hierarchy',
  description: 'Counts matching regulation text and groups the totals through the CFR hierarchy, optionally for one agency.',
  positional: { name: 'query', description: 'Text to count.', schema: z.string().min(1) },
  flags: ['agency', 'fields'],
  input: flagObject(['agency', 'fields']).extend({ query: z.string().min(1) }),
  network: 'remote',
  request: async input => {
    const query = new URLSearchParams({ query: input.query })
    if (input.agency) query.set('agency', input.agency)
    return { path: `/api/search/v1/counts/hierarchy?${query}`, accept: 'json', params: input, defaulted: [] }
  },
  output: z.looseObject({
    count: z.looseObject({ value: z.number(), relation: z.string() }),
    max_score: z.number(),
    children: z.array(countNodeSchema),
  }),
  render: data => {
    const lines = [chalk.bold(`Total: ${data.count.value} results`), '']
    renderCountTree(data.children, lines, 0)
    return lines.join('\n')
  },
  examples: [
    { command: 'ecfr counts cybersecurity', description: 'Count matches across the CFR hierarchy' },
    { command: 'ecfr counts cybersecurity --agency defense-department', description: 'Count matches for one agency' },
  ],
})
