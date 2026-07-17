import { describe, it, expect } from 'vitest'
import { constrainByConditions, type ConditionEvaluator, type RawField } from './conditions'
import type { FieldNode } from './types'

// Evaluator: run the real condition fn with (data, siblingData, ctx).
const evaluate: ConditionEvaluator = (cond, sibling) => Boolean(cond({}, sibling, {}))

describe('constrainByConditions', () => {
  it('restricts a select to the option values that avoid a conditionally-required upload', () => {
    const raw: RawField[] = [
      {
        type: 'group',
        name: 'hero',
        fields: [
          { type: 'select', name: 'type', required: true, options: ['none', 'highImpact', 'mediumImpact', 'lowImpact'] },
          {
            type: 'upload',
            name: 'media',
            required: true,
            relationTo: 'media',
            admin: { condition: (_d, s) => ['highImpact', 'mediumImpact'].includes((s as { type?: string }).type ?? '') },
          },
        ],
      },
    ]
    const nodes: FieldNode[] = [
      {
        name: 'hero',
        type: 'group',
        fields: [
          { name: 'type', type: 'select', options: ['none', 'highImpact', 'mediumImpact', 'lowImpact'] },
          { name: 'media', type: 'upload', relationTo: 'media', isMedia: true },
        ],
      },
    ]

    const blocked = constrainByConditions(raw, nodes, ['media'], evaluate)
    expect(blocked).toBe(false)
    expect(nodes[0]!.unsatisfiable).toBeFalsy()
    expect(nodes[0]!.fields!.find((f) => f.name === 'type')!.options).toEqual(['none', 'lowImpact'])
  })

  it('marks a block unsatisfiable when it has an unconditional required upload', () => {
    const raw: RawField[] = [
      {
        type: 'blocks',
        name: 'layout',
        blocks: [
          { slug: 'text', fields: [{ type: 'richText', name: 'body', required: true }] },
          { slug: 'image', fields: [{ type: 'upload', name: 'img', required: true, relationTo: 'media' }] },
        ],
      },
    ]
    const nodes: FieldNode[] = [
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          { slug: 'text', fields: [{ name: 'body', type: 'richText', required: true, isRichText: true }] },
          { slug: 'image', fields: [{ name: 'img', type: 'upload', relationTo: 'media', isMedia: true }] },
        ],
      },
    ]

    constrainByConditions(raw, nodes, ['media'], evaluate)
    const blocks = nodes[0]!.blocks!
    expect(blocks.find((b) => b.slug === 'image')!.unsatisfiable).toBe(true)
    expect(blocks.find((b) => b.slug === 'text')!.unsatisfiable).toBeFalsy()
  })

  it('marks a group unsatisfiable when a required upload cannot be avoided by any option', () => {
    const raw: RawField[] = [
      {
        type: 'group',
        name: 'banner',
        fields: [
          { type: 'select', name: 'style', required: true, options: ['a', 'b'] },
          { type: 'upload', name: 'img', required: true, relationTo: 'media', admin: { condition: () => true } },
        ],
      },
    ]
    const nodes: FieldNode[] = [
      {
        name: 'banner',
        type: 'group',
        fields: [
          { name: 'style', type: 'select', options: ['a', 'b'] },
          { name: 'img', type: 'upload', relationTo: 'media', isMedia: true },
        ],
      },
    ]
    constrainByConditions(raw, nodes, ['media'], evaluate)
    expect(nodes[0]!.unsatisfiable).toBe(true)
  })

  it('leaves a media-free scope untouched', () => {
    const raw: RawField[] = [
      { type: 'text', name: 'title', required: true },
      { type: 'select', name: 'cat', options: ['x', 'y'] },
    ]
    const nodes: FieldNode[] = [
      { name: 'title', type: 'text', required: true },
      { name: 'cat', type: 'select', options: ['x', 'y'] },
    ]
    const blocked = constrainByConditions(raw, nodes, ['media'], evaluate)
    expect(blocked).toBe(false)
    expect(nodes[1]!.options).toEqual(['x', 'y'])
  })
})
