import { XMLParser } from 'fast-xml-parser'

export interface SectionMeta {
  number: string | null
  citation: string | null
  alternate_reference: string | null
  federal_register_citation: string | null
}

export interface ParsedRegulation {
  content: string
  sections: SectionMeta[]
}

type OrderedNode = Record<string, unknown>

const inlineTags = new Set(['I', 'E', 'B', 'SU', 'SUB', 'SUP', 'R', 'T'])

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  preserveOrder: true,
  trimValues: false,
})

export function parseRegulation(xml: string): ParsedRegulation {
  const parsed = parser.parse(xml) as unknown
  const blocks: string[] = []
  const sections: SectionMeta[] = []

  if (Array.isArray(parsed)) collect(parsed, blocks, sections)

  return { content: blocks.join('\n\n'), sections }
}

export function xmlToText(xml: string): string {
  return parseRegulation(xml).content
}

function collect(nodes: unknown[], blocks: string[], sections: SectionMeta[]): void {
  for (const node of nodes) {
    const element = asElement(node)
    if (!element) continue

    if (element.attributes['@_TYPE'] === 'SECTION') {
      sections.push(sectionMeta(element))
    }

    if (element.tag === 'CITA') continue

    if (isContainer(element.children)) {
      collect(element.children, blocks, sections)
      continue
    }

    const block = descendantText(element.children).trim()
    if (block) blocks.push(block)
  }
}

function asElement(node: unknown): { tag: string; children: unknown[]; attributes: OrderedNode } | null {
  if (!isOrderedNode(node) || '#text' in node) return null

  const tag = Object.keys(node).find(key => key !== ':@')
  if (!tag) return null

  return {
    tag,
    children: Array.isArray(node[tag]) ? node[tag] : [],
    attributes: isOrderedNode(node[':@']) ? node[':@'] : {},
  }
}

function isContainer(children: unknown[]): boolean {
  return children.some(child => {
    const element = asElement(child)
    return element !== null && !inlineTags.has(element.tag)
  })
}

function descendantText(nodes: unknown[]): string {
  let content = ''
  for (const node of nodes) {
    if (!isOrderedNode(node)) continue
    if (typeof node['#text'] === 'string' || typeof node['#text'] === 'number') {
      content += String(node['#text'])
      continue
    }
    const element = asElement(node)
    if (element) content += descendantText(element.children)
  }
  return content
}

function sectionMeta(element: { children: unknown[]; attributes: OrderedNode }): SectionMeta {
  const hierarchy = parseHierarchyMetadata(element.attributes['@_hierarchy_metadata'])
  const citation = findCitation(element.children)
  return {
    number: stringAttribute(element.attributes['@_N']),
    citation: hierarchy.citation,
    alternate_reference: hierarchy.alternate_reference,
    federal_register_citation: citation ? citation.trim() || null : null,
  }
}

function parseHierarchyMetadata(value: unknown): { citation: string | null; alternate_reference: string | null } {
  if (typeof value !== 'string' || value.length === 0) {
    return { citation: null, alternate_reference: null }
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!isOrderedNode(parsed)) return { citation: null, alternate_reference: null }
    return {
      citation: stringAttribute(parsed.citation),
      alternate_reference: stringAttribute(parsed.alternate_reference),
    }
  } catch {
    return { citation: null, alternate_reference: null }
  }
}

function findCitation(nodes: unknown[]): string | null {
  for (const node of nodes) {
    const element = asElement(node)
    if (!element) continue
    if (element.tag === 'CITA') return descendantText(element.children)
    if (element.attributes['@_TYPE'] === 'SECTION') continue
    const citation = findCitation(element.children)
    if (citation !== null) return citation
  }
  return null
}

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isOrderedNode(value: unknown): value is OrderedNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
