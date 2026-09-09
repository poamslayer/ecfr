import chalk from 'chalk'
import { z } from 'zod'
import { CliError } from '../../runtime/errors.js'
import { flagObject, flags, structureLevels, structureLevelValues } from '../flags.js'
import { defineOperation } from '../types.js'

export interface StructureNode {
  identifier: string
  label: string
  type?: string
  label_description?: string
  children?: StructureNode[]
  withheld_children?: number
  [key: string]: unknown
}

const structureNodeSchema: z.ZodType<StructureNode> = z.lazy(() => z.looseObject({
  identifier: z.string(),
  label: z.string(),
  type: z.string().optional(),
  label_description: z.string().optional(),
  children: z.array(structureNodeSchema).optional(),
  withheld_children: z.number().int().positive().optional(),
}))

export { structureLevels }
export type StructureLevel = (typeof structureLevels)[number]
export type StructureLevelValue = (typeof structureLevelValues)[number]

export const structureLevelRanks: Readonly<Record<StructureLevel, number>> = {
  title: 1,
  subtitle: 2,
  chapter: 3,
  subchapter: 4,
  part: 5,
  subpart: 6,
  subject_group: 7,
  section: 8,
  appendix: 8,
  hed1: 8,
}

function rankOf(type: string | undefined): number {
  return structureLevelRanks[type as StructureLevel] ?? 9
}

/** Keep a complete answer through one named CFR level; never cut a node or field. */
export function pruneStructure(node: StructureNode, level: StructureLevelValue): StructureNode {
  if (level === 'all') return node

  const maxRank = structureLevelRanks[level]
  const children = node.children
  if (children === undefined || children.length === 0) return node

  const kept: StructureNode[] = []
  let withheld = 0
  for (const child of children) {
    if (rankOf(child.type) <= maxRank) kept.push(pruneStructure(child, level))
    else withheld += 1
  }

  const { withheld_children: _previous, ...base } = node
  return {
    ...base,
    children: kept,
    ...(withheld === 0 ? {} : { withheld_children: withheld }),
  }
}

interface Match {
  node: StructureNode
  depth: number
}

/**
 * An identifier is not unique across a title: `B` names a subtitle, five subchapters and 57
 * subparts in Title 32, and `2` names a chapter and several parts in Title 48. The shallowest
 * match is what a caller means — `--under 2` after reading the chapter list means chapter 2 —
 * so depth decides, and only a tie at that depth is ambiguous.
 */
function matchesFor(root: StructureNode, target: { type?: string; identifier: string }): Match[] {
  const found: Match[] = []
  const visit = (node: StructureNode, depth: number): void => {
    const sameId = node.identifier === target.identifier
    const sameType = target.type === undefined || node.type === target.type
    if (sameId && sameType) found.push({ node, depth })
    for (const child of node.children ?? []) visit(child, depth + 1)
  }
  visit(root, 0)
  if (found.length === 0) return found
  const shallowest = Math.min(...found.map(match => match.depth))
  return found.filter(match => match.depth === shallowest)
}

/** `chapter:2` selects by type as well as identifier, for a tie at one level. */
function parseUnder(value: string): { type?: string; identifier: string } {
  const separator = value.indexOf(':')
  if (separator === -1) return { identifier: value }
  return { type: value.slice(0, separator), identifier: value.slice(separator + 1) }
}

function underRemediation(title: string): string {
  return `Run \`ecfr structure ${title}\` to list identifiers at the level above, then pass a unique identifier with --under.`
}

export function selectStructure(
  root: StructureNode,
  params: { title: string; level: StructureLevelValue; under?: string },
): StructureNode {
  if (params.under === undefined) return pruneStructure(root, params.level)

  const target = parseUnder(params.under)
  const matches = matchesFor(root, target)
  if (matches.length === 0) {
    throw new CliError('USAGE', `--under did not match identifier "${params.under}" in Title ${params.title}.`, {
      field: 'under',
      remediation: underRemediation(params.title),
      details: { under: params.under, matches: 0 },
    })
  }
  if (matches.length > 1) {
    const types = [...new Set(matches.map(match => match.node.type ?? 'unknown'))]
    const qualified = types.map(type => `${type}:${target.identifier}`)
    throw new CliError('USAGE', `--under matched ${matches.length} nodes at the same level for identifier "${params.under}".`, {
      field: 'under',
      remediation: `Qualify it by type: pass --under with one of ${qualified.join(', ')}.`,
      details: {
        under: params.under,
        matches: matches.length,
        types,
        qualified,
      },
    })
  }

  return pruneStructure(matches[0]!.node, params.level)
}

function renderTree(node: StructureNode, lines: string[], depth: number): void {
  const indent = '  '.repeat(depth)
  const description = node.label_description ? ` — ${node.label_description}` : ''
  const withheld = node.withheld_children === undefined ? '' : ` (${node.withheld_children} children withheld)`
  const label = depth === 0
    ? chalk.bold(`${node.label}${description}${withheld}`)
    : `${indent}${node.label}${description}${withheld}`
  lines.push(label)
  for (const child of node.children ?? []) renderTree(child, lines, depth + 1)
}

export const structure = defineOperation({
  name: 'structure',
  kind: 'get',
  summary: 'Browse hierarchy of a CFR title',
  description: `Returns the hierarchy of one CFR title at an issue date, complete through one named level rather than cut to a byte budget. --level accepts ${structureLevelValues.join(', ')} and defaults to chapter, or part when --under is given; --level all returns the whole tree. A node whose children were not returned carries withheld_children with the count, so a caller always knows where more exists. --under narrows Data to the subtree at one identifier; the shallowest match wins, so --under 2 finds chapter 2 rather than a part numbered 2 deeper in the tree, and a tie at one level is qualified as <type>:<identifier>, such as chapter:2.`,
  positional: { name: 'title', description: 'CFR title number.', schema: flags.title.schema },
  flags: ['date', 'level', 'under', 'fields'],
  input: flagObject(['date', 'level', 'under', 'fields']).extend({ title: flags.title.schema }),
  network: 'remote',
  titleScoped: true,
  request: async (input, ctx) => {
    const date = input.date ?? (await ctx.currency(input.title)).latest_issue_date
    const level = input.level ?? (input.under === undefined ? 'chapter' : 'part')
    return {
      path: `/api/versioner/v1/structure/${date}/title-${input.title}.json`,
      accept: 'json',
      params: { ...input, date, level },
      defaulted: [
        ...(input.date === undefined ? ['date'] : []),
        ...(input.level === undefined ? ['level'] : []),
      ],
    }
  },
  transform: (res, input) => selectStructure(res.body as StructureNode, {
    title: input.title,
    level: input.level ?? (input.under === undefined ? 'chapter' : 'part'),
    ...(input.under === undefined ? {} : { under: input.under }),
  }),
  output: structureNodeSchema,
  render: data => {
    const lines: string[] = []
    renderTree(data, lines, 0)
    return lines.join('\n')
  },
  examples: [
    { command: 'ecfr structure 32', description: 'List Title 32 through its chapters' },
    { command: 'ecfr structure 48 --under 2', description: 'Drill into chapter 2 and list its parts, including DFARS part 252' },
    { command: 'ecfr structure 32 --under chapter:XX --level all', description: 'Return the complete subtree under one chapter, qualified by type' },
    { command: 'ecfr structure 32 --date 2025-01-01', description: 'Browse a historical issue date' },
  ],
})
