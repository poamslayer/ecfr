import { describe, expect, it } from 'vitest'
import {
  pruneStructure,
  structureLevelRanks,
  structureLevels,
  type StructureNode,
} from '../src/schema/ops/structure.js'

const tree: StructureNode = {
  identifier: 'title',
  label: 'Title',
  type: 'title',
  children: [{
    identifier: 'subtitle',
    label: 'Subtitle',
    type: 'subtitle',
    children: [{
      identifier: 'chapter',
      label: 'Chapter',
      type: 'chapter',
      children: [{
        identifier: 'subchapter',
        label: 'Subchapter',
        type: 'subchapter',
        children: [{
          identifier: 'part',
          label: 'Part',
          type: 'part',
          children: [{
            identifier: 'subpart',
            label: 'Subpart',
            type: 'subpart',
            children: [{
              identifier: 'subject-group',
              label: 'Subject group',
              type: 'subject_group',
              children: [
                { identifier: 'section', label: 'Section', type: 'section' },
                { identifier: 'appendix', label: 'Appendix', type: 'appendix' },
                { identifier: 'hed1', label: 'Heading', type: 'hed1' },
                { identifier: 'future', label: 'Future type', type: 'future_type' },
              ],
            }],
          }],
        }],
      }],
    }],
  }],
}

function typesIn(node: StructureNode): string[] {
  return [node.type ?? 'unknown', ...(node.children ?? []).flatMap(typesIn)]
}

describe('structure rank pruning', () => {
  it('implements the fixed coarse-to-fine rank table', () => {
    expect(structureLevelRanks).toEqual({
      title: 1,
      subtitle: 2,
      chapter: 3,
      subchapter: 4,
      part: 5,
      subpart: 6,
      subject_group: 7,
      section: 8,
      appendix: 8,
      hed1: 8,
    })
  })

  it.each([
    ['title', ['title']],
    ['subtitle', ['title', 'subtitle']],
    ['chapter', ['title', 'subtitle', 'chapter']],
    ['subchapter', ['title', 'subtitle', 'chapter', 'subchapter']],
    ['part', ['title', 'subtitle', 'chapter', 'subchapter', 'part']],
    ['subpart', ['title', 'subtitle', 'chapter', 'subchapter', 'part', 'subpart']],
    ['subject_group', ['title', 'subtitle', 'chapter', 'subchapter', 'part', 'subpart', 'subject_group']],
    ['section', ['title', 'subtitle', 'chapter', 'subchapter', 'part', 'subpart', 'subject_group', 'section', 'appendix', 'hed1']],
    ['appendix', ['title', 'subtitle', 'chapter', 'subchapter', 'part', 'subpart', 'subject_group', 'section', 'appendix', 'hed1']],
    ['hed1', ['title', 'subtitle', 'chapter', 'subchapter', 'part', 'subpart', 'subject_group', 'section', 'appendix', 'hed1']],
  ] as const)('%s keeps exactly the types at or above its rank', (level, expected) => {
    expect(typesIn(pruneStructure(tree, level))).toEqual(expected)
  })

  it('treats an unknown future type as rank 9 and prunes it at every named level', () => {
    for (const level of structureLevels) {
      expect(typesIn(pruneStructure(tree, level))).not.toContain('future_type')
    }
  })

  it('adds withheld_children only where immediate children were removed', () => {
    const pruned = pruneStructure(tree, 'chapter')
    const subtitle = pruned.children?.[0]
    const chapter = subtitle?.children?.[0]

    expect(pruned).not.toHaveProperty('withheld_children')
    expect(subtitle).not.toHaveProperty('withheld_children')
    expect(chapter).toHaveProperty('withheld_children', 1)
    expect(chapter?.children).toEqual([])
  })

  it('all returns the untouched tree', () => {
    expect(pruneStructure(tree, 'all')).toEqual(tree)
  })
})
