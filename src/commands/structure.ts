import chalk from 'chalk'
import { ecfrFetch, latestDate } from '../api.js'
import { shouldOutputJson, output } from '../formatter.js'

interface StructureNode {
  identifier: string
  label: string
  label_description?: string
  children: StructureNode[]
}

export async function structureAction(
  title: string,
  opts: { date?: string },
  globalOpts: { json?: boolean },
): Promise<void> {
  const date = opts.date ?? await latestDate(title)
  const data = await ecfrFetch(`/api/versioner/v1/structure/${date}/title-${title}.json`) as StructureNode
  const asJson = shouldOutputJson(globalOpts)

  if (asJson) {
    output(data, '', true)
    return
  }

  const lines: string[] = []
  renderTree(data, lines, 0)
  output(data, lines.join('\n'), false)
}

function renderTree(node: StructureNode, lines: string[], depth: number): void {
  const indent = '  '.repeat(depth)
  const desc = node.label_description ? ` — ${node.label_description}` : ''
  const label = depth === 0
    ? chalk.bold(`${node.label}${desc}`)
    : `${indent}${node.label}${desc}`
  lines.push(label)

  for (const child of node.children ?? []) {
    renderTree(child, lines, depth + 1)
  }
}
