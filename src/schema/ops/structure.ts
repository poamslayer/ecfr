import chalk from 'chalk'
import { z } from 'zod'
import { flagObject, flags } from '../flags.js'
import { defineOperation } from '../types.js'

interface StructureNode {
  identifier: string
  label: string
  label_description?: string
  children: StructureNode[]
}

const structureNodeSchema: z.ZodType<StructureNode> = z.lazy(() => z.looseObject({
  identifier: z.string(),
  label: z.string(),
  label_description: z.string().optional(),
  children: z.array(structureNodeSchema),
}))

function renderTree(node: StructureNode, lines: string[], depth: number): void {
  const indent = '  '.repeat(depth)
  const description = node.label_description ? ` — ${node.label_description}` : ''
  const label = depth === 0 ? chalk.bold(`${node.label}${description}`) : `${indent}${node.label}${description}`
  lines.push(label)
  for (const child of node.children ?? []) renderTree(child, lines, depth + 1)
}

export const structure = defineOperation({
  name: 'structure',
  kind: 'get',
  summary: 'Browse hierarchy of a CFR title',
  description: 'Returns the hierarchy of one CFR title at an issue date, defaulting to the latest issue date published for that title.',
  positional: { name: 'title', description: 'CFR title number.', schema: flags.title.schema },
  flags: ['date'],
  input: flagObject(['date']).extend({ title: flags.title.schema }),
  network: 'remote',
  titleScoped: true,
  request: async (input, ctx) => {
    const date = input.date ?? (await ctx.currency(input.title)).latest_issue_date
    return {
      path: `/api/versioner/v1/structure/${date}/title-${input.title}.json`,
      accept: 'json',
      params: { ...input, date },
      defaulted: input.date ? [] : ['date'],
    }
  },
  output: structureNodeSchema,
  render: data => {
    const lines: string[] = []
    renderTree(data, lines, 0)
    return lines.join('\n')
  },
  examples: [
    { command: 'ecfr structure 32', description: 'Browse the latest hierarchy for Title 32' },
    { command: 'ecfr structure 32 --date 2025-01-01', description: 'Browse a historical issue date' },
  ],
})
