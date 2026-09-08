import type { TitleCurrency, UpstreamRequest, UpstreamResponse } from '../schema/types.js'
import { CliError } from './errors.js'

type FetchUpstream = (req: UpstreamRequest) => Promise<UpstreamResponse>

interface CurrencyTitle extends TitleCurrency {
  number: number
}

export function makeCurrencyLookup(fetchUpstream: FetchUpstream): (title: string) => Promise<TitleCurrency> {
  const byTitle = new Map<string, Promise<TitleCurrency>>()

  return title => {
    const key = String(title)
    const existing = byTitle.get(key)
    if (existing) return existing

    const lookup = fetchUpstream({ path: '/api/versioner/v1/titles', accept: 'json' })
      .then(res => {
        const body = res.body as { titles?: CurrencyTitle[] }
        const match = body.titles?.find(candidate => String(candidate.number) === key)
        if (!match) {
          throw new CliError('NOT_FOUND', `Title ${key} was not found in the eCFR title list.`, {
            remediation: 'Run `ecfr titles` to list valid title numbers.',
            details: { title: key },
          })
        }
        return {
          latest_issue_date: match.latest_issue_date,
          latest_amended_on: match.latest_amended_on,
          up_to_date_as_of: match.up_to_date_as_of,
        }
      })
      .catch(err => {
        byTitle.delete(key)
        throw err
      })

    byTitle.set(key, lookup)
    return lookup
  }
}
