import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/api.js', () => ({
  ecfrFetch: vi.fn(),
}))

import { ecfrFetch } from '../../src/api.js'
import { searchAction } from '../../src/commands/search.js'

describe('searchAction', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  const mockFetch = vi.mocked(ecfrFetch)

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('builds query params and fetches search results', async () => {
    const data = {
      results: [{
        hierarchy: { title: '32', section: '2002.14' },
        hierarchy_headings: { title: 'National Defense', section: 'Safeguarding' },
        full_text_excerpt: '...controlled unclassified information...',
        score: 12.4,
        starts_on: '2025-11-01',
      }],
      meta: { current_page: 1, total_pages: 3, total_count: 47 },
    }
    mockFetch.mockResolvedValueOnce(data)

    await searchAction('CUI', { title: '32', page: '1' }, { json: true })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search/v1/results?query=CUI')
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('hierarchy%5Btitle%5D=32')
    )
  })

  it('renders human output with excerpts', async () => {
    const originalIsTTY = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true })

    const data = {
      results: [{
        hierarchy: { title: '32', section: '2002.14' },
        hierarchy_headings: { title: 'National Defense', section: 'Safeguarding' },
        full_text_excerpt: '...controlled unclassified information...',
        score: 12.4,
        starts_on: '2025-11-01',
      }],
      meta: { current_page: 1, total_pages: 3, total_count: 47 },
    }
    mockFetch.mockResolvedValueOnce(data)

    await searchAction('CUI', {}, { json: false })
    const outputText = logSpy.mock.calls[0][0] as string
    expect(outputText).toContain('47 results')
    expect(outputText).toContain('Safeguarding')

    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true })
  })
})
