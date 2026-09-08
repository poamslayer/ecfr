import { describe, expect, it } from 'vitest'
import { parseRegulation, type SectionMeta, xmlToText } from '../src/xml-parser.js'

interface ParserCase {
  name: string
  xml: string
  content: string
  sections?: SectionMeta[]
}

const nullSection = (number: string | null): SectionMeta => ({
  number,
  citation: null,
  alternate_reference: null,
  federal_register_citation: null,
})

const cases: ParserCase[] = [
  {
    name: 'keeps tight punctuation at an inline element boundary',
    xml: '<ROOT><P>(<I>e.g.,</I> x)</P></ROOT>',
    content: '(e.g., x)',
  },
  {
    name: 'keeps source whitespace between an inline term and its definition',
    xml: '<ROOT><P><I>Adequate security</I> means</P></ROOT>',
    content: 'Adequate security means',
  },
  {
    name: 'keeps a numeric-looking text run byte for byte',
    xml: '<ROOT><P>001</P></ROOT>',
    content: '001',
  },
  {
    name: 'preserves document order through mixed blocks and containers',
    xml: '<DIV8><HEAD>Heading</HEAD><P>Prescription</P><EXTRACT><HD1>Clause</HD1><P>Body</P></EXTRACT><HD3>(End of clause)</HD3></DIV8>',
    content: 'Heading\n\nPrescription\n\nClause\n\nBody\n\n(End of clause)',
  },
  {
    name: 'joins adjacent blocks with exactly one blank line',
    xml: '<ROOT><ONE>First</ONE> \n <TWO>Second</TWO></ROOT>',
    content: 'First\n\nSecond',
  },
  {
    name: 'trims a block trailing newline before joining blocks',
    xml: '<ROOT><HD1>Clause\n</HD1><P>Body</P></ROOT>',
    content: 'Clause\n\nBody',
  },
  {
    name: 'treats every member of the inline set as inline',
    xml: '<ROOT><P><I>I</I><E>E</E><B>B</B><SU>SU</SU><SUB>SUB</SUB><SUP>SUP</SUP><R>R</R><T>T</T></P></ROOT>',
    content: 'IEBSUSUBSUPRT',
  },
  {
    name: 'excludes CITA from Content and captures it in section metadata',
    xml: '<DIV8 TYPE="SECTION" N="1" hierarchy_metadata="{&quot;citation&quot;:&quot;48 CFR 1&quot;,&quot;alternate_reference&quot;:&quot;FAR 1&quot;}"><HEAD>Heading</HEAD><CITA>[1 FR 2]\n</CITA></DIV8>',
    content: 'Heading',
    sections: [{
      number: '1',
      citation: '48 CFR 1',
      alternate_reference: 'FAR 1',
      federal_register_citation: '[1 FR 2]',
    }],
  },
  {
    name: 'returns null hierarchy fields when hierarchy_metadata is absent',
    xml: '<DIV8 TYPE="SECTION" N="2"><P>Body</P></DIV8>',
    content: 'Body',
    sections: [nullSection('2')],
  },
  {
    name: 'returns null hierarchy fields when hierarchy_metadata is malformed',
    xml: '<DIV8 TYPE="SECTION" N="3" hierarchy_metadata="not-json"><P>Body</P></DIV8>',
    content: 'Body',
    sections: [nullSection('3')],
  },
  {
    name: 'always returns an empty sections list when there is no section',
    xml: '<ROOT><P>Body</P></ROOT>',
    content: 'Body',
    sections: [],
  },
  {
    name: 'returns two sections in document order',
    xml: '<ROOT><ITEM TYPE="SECTION" N="first"><P>One</P></ITEM><OTHER TYPE="SECTION" N="second"><P>Two</P></OTHER></ROOT>',
    content: 'One\n\nTwo',
    sections: [nullSection('first'), nullSection('second')],
  },
]

describe('parseRegulation', () => {
  it.each(cases)('$name', ({ xml, content, sections }) => {
    expect(parseRegulation(xml)).toEqual({ content, sections: sections ?? [] })
  })

  it('retains xmlToText as a Content-only compatibility export', () => {
    expect(xmlToText('<ROOT><P>Content</P></ROOT>')).toBe('Content')
  })
})
