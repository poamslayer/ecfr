import chalk from 'chalk'
import { ecfrFetch } from '../api.js'
import { shouldOutputJson, output } from '../formatter.js'

interface CountNode {
  level: string
  hierarchy: string | null
  hierarchy_heading: string | null
  heading: string | null
  count: number
  max_score: number
  children?: CountNode[]
}

interface CountsResponse {
  count: { value: number; relation: string }
  max_score: number
  children: CountNode[]
}

export async function countsAction(
  query: string,
  opts: { agency?: string },
  globalOpts: { json?: boolean },
): Promise<void> {
  const params = new URLSearchParams({ query })
  if (opts.agency) params.set('agency', opts.agency)

  const data = await ecfrFetch(`/api/search/v1/counts/hierarchy?${params}`) as CountsResponse
  const asJson = shouldOutputJson(globalOpts)

  if (asJson) {
    output(data, '', true)
    return
  }

  const lines: string[] = []
  lines.push(chalk.bold(`Total: ${data.count.value} results`))
  lines.push('')

  renderCountTree(data.children, lines, 0)

  output(data, lines.join('\n'), false)
}

function renderCountTree(
  nodes: CountNode[],
  lines: string[],
  depth: number,
): void {
  const indent = '  '.repeat(depth)
  for (const node of nodes) {
    const label = node.heading
      ? `${node.hierarchy_heading ?? node.hierarchy ?? node.level} — ${node.heading}`
      : (node.hierarchy_heading ?? node.hierarchy ?? node.level)
    lines.push(`${indent}${label}: ${chalk.yellow(String(node.count))}`)
    if (node.children && node.children.length > 0) {
      renderCountTree(node.children, lines, depth + 1)
    }
  }
}
