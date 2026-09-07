import chalk from 'chalk'
import { ecfrFetch } from '../api.js'
import { shouldOutputJson, output } from '../formatter.js'

interface SearchResult {
  hierarchy: { title: string; section: string }
  hierarchy_headings: { title: string; section: string }
  full_text_excerpt: string
  score: number
  starts_on: string
}

interface SearchResponse {
  results: SearchResult[]
  meta: { current_page: number; total_pages: number; total_count: number }
}

export async function searchAction(
  query: string,
  opts: { title?: string; agency?: string; page?: string; perPage?: string },
  globalOpts: { json?: boolean },
): Promise<void> {
  const params = new URLSearchParams({ query })
  if (opts.title) params.set('hierarchy[title]', opts.title)
  if (opts.agency) params.set('agency', opts.agency)
  if (opts.page) params.set('page', opts.page)
  if (opts.perPage) params.set('per_page', opts.perPage)

  const data = await ecfrFetch(`/api/search/v1/results?${params}`) as SearchResponse
  const asJson = shouldOutputJson(globalOpts)

  if (asJson) {
    output(data, '', true)
    return
  }

  const { meta, results } = data
  const lines: string[] = []
  lines.push(chalk.bold(`Found ${meta.total_count} results (page ${meta.current_page}/${meta.total_pages})`))
  lines.push('')

  for (const r of results) {
    const heading = r.hierarchy_headings?.section ?? r.hierarchy?.section ?? ''
    lines.push(chalk.cyan(`${r.hierarchy.title} CFR \u00A7 ${r.hierarchy.section}`) + ` \u2014 ${heading}`)
    lines.push(`  "${r.full_text_excerpt}"`)
    lines.push(`  Score: ${r.score} | Modified: ${r.starts_on}`)
    lines.push('')
  }

  output(data, lines.join('\n'), false)
}
