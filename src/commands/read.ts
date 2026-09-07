import chalk from 'chalk'
import { ecfrFetchXml, latestDate } from '../api.js'
import { shouldOutputJson, output } from '../formatter.js'
import { xmlToText } from '../xml-parser.js'

export async function readAction(
  title: string,
  opts: { part?: string; section?: string; date?: string; xml?: boolean },
  globalOpts: { json?: boolean },
): Promise<void> {
  const date = opts.date ?? await latestDate(title)

  let path = `/api/versioner/v1/full/${date}/title-${title}.xml`
  const params = new URLSearchParams()
  if (opts.part) params.set('part', opts.part)
  if (opts.section) params.set('section', opts.section)
  const qs = params.toString()
  if (qs) path += `?${qs}`

  const xml = await ecfrFetchXml(path)

  if (opts.xml) {
    console.log(xml)
    return
  }

  const asJson = shouldOutputJson(globalOpts)
  if (asJson) {
    output({ title, date, content: xmlToText(xml) }, '', true)
    return
  }

  console.log(chalk.bold(`Title ${title} — as of ${date}`))
  console.log('')
  console.log(xmlToText(xml))
}
