import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const fixtureDirectory = path.resolve(import.meta.dirname, '../fixtures')

export interface RecordedFixture {
  url: string
  accept: 'json' | 'xml'
  content_type: string
  fetched_at: string
  body: unknown
}

export function loadFixture(slug: string): RecordedFixture {
  return JSON.parse(readFileSync(path.join(fixtureDirectory, `${slug}.json`), 'utf8')) as RecordedFixture
}

export function fixtureUrl(slug: string): string {
  return loadFixture(slug).url
}

export function fixtureFetch(): typeof globalThis.fetch {
  const byUrl = new Map<string, RecordedFixture>()
  for (const filename of readdirSync(fixtureDirectory).filter(name => name.endsWith('.json'))) {
    const fixture = loadFixture(filename.slice(0, -'.json'.length))
    byUrl.set(fixture.url, fixture)
  }

  return (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)
    const fixture = byUrl.get(url)
    if (!fixture) {
      return new Response(JSON.stringify({ error: `No fixture for ${url}` }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    const body = typeof fixture.body === 'string' ? fixture.body : JSON.stringify(fixture.body)
    return new Response(body, {
      status: 200,
      headers: { 'content-type': fixture.content_type },
    })
  }) as typeof globalThis.fetch
}
