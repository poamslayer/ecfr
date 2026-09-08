import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fetchUpstream } from '../src/runtime/api.js'
import { makeCurrencyLookup } from '../src/runtime/currency.js'
import { operations, type AnyOperation, type UpstreamResponse } from '../src/schema/index.js'

const root = path.resolve(import.meta.dirname, '..')
const fixtureDirectory = path.join(root, 'test/fixtures')

interface FixtureSpec {
  slug: string
  operation: string
  input: Record<string, unknown>
}

const specs: FixtureSpec[] = [
  { slug: 'agencies', operation: 'agencies', input: {} },
  { slug: 'structure-32', operation: 'structure', input: { title: '32', date: '2026-08-17' } },
  {
    slug: 'search-cui-title-32',
    operation: 'search',
    input: { query: 'controlled unclassified information', title: '32', perPage: 5 },
  },
  { slug: 'counts-cybersecurity', operation: 'counts', input: { query: 'cybersecurity' } },
  { slug: 'changes-32-part-2002', operation: 'changes', input: { title: '32', part: '2002' } },
  { slug: 'corrections-title-32', operation: 'corrections', input: { title: '32' } },
  {
    slug: 'read-32-2002-14',
    operation: 'read',
    input: { title: '32', part: '2002', section: '2002.14', date: '2026-08-17' },
  },
  {
    slug: 'read-48-252-204-7012',
    operation: 'read',
    input: { title: '48', part: '252', section: '252.204-7012', date: '2026-09-01' },
  },
]

function operationNamed(name: string): AnyOperation {
  const operation = operations.find(candidate => candidate.name === name)
  if (!operation) throw new Error(`unknown operation: ${name}`)
  return operation
}

function serializedBody(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body)
}

async function writeFixture(slug: string, request: { accept: 'json' | 'xml' }, response: UpstreamResponse): Promise<void> {
  const fixture = {
    url: response.url,
    accept: request.accept,
    content_type: response.content_type,
    fetched_at: response.fetched_at,
    body: response.body,
  }
  const output = `${JSON.stringify(fixture)}\n`
  await writeFile(path.join(fixtureDirectory, `${slug}.json`), output)
  process.stdout.write(`${response.url} ${Buffer.byteLength(serializedBody(response.body))} bytes\n`)
}

async function main(): Promise<void> {
  await mkdir(fixtureDirectory, { recursive: true })

  const titles = operationNamed('titles')
  const titlesInput = titles.input.parse({})
  const unavailableCtx = { currency: async () => { throw new Error('titles must not resolve currency') } }
  const titlesRequest = await titles.request!(titlesInput, unavailableCtx)
  const titlesResponse = await fetchUpstream(titlesRequest)
  await writeFixture('titles', titlesRequest, titlesResponse)

  const currency = makeCurrencyLookup(async request => {
    if (request.path === titlesRequest.path && request.accept === titlesRequest.accept) return titlesResponse
    return fetchUpstream(request)
  })
  const ctx = { currency }

  for (const spec of specs) {
    const operation = operationNamed(spec.operation)
    const input = operation.input.parse(spec.input)
    const request = await operation.request!(input, ctx)
    const response = await fetchUpstream(request)
    await writeFixture(spec.slug, request, response)
  }
}

await main()
