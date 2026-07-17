import { describe, it, expect, vi } from 'vitest'
import {
  applyRelationDefaults,
  enrichRelations,
  filterBlocks,
  resolvePolymorphicValues,
  type RelationFinder,
} from './relations'
import type { FieldNode } from './types'

const finder = (over: Partial<Record<string, { total: number; n: number }>> = {}): RelationFinder =>
  vi.fn(async (collection: string) => {
    const cfg = over[collection] ?? { total: 2, n: 2 }
    return {
      total: cfg.total,
      options: Array.from({ length: cfg.n }, (_, i) => ({
        value: `${collection}-${i}`,
        label: `${collection} ${i}`,
      })),
    }
  })

describe('enrichRelations', () => {
  it('attaches relationOptions for a non-media relationship under the cap', async () => {
    const fields: FieldNode[] = [{ name: 'author', type: 'relationship', relationTo: 'authors' }]
    const out = await enrichRelations(fields, finder(), 100)
    expect(out[0]!.relationOptions).toEqual([
      { value: 'authors-0', label: 'authors 0' },
      { value: 'authors-1', label: 'authors 1' },
    ])
    expect(out[0]!.cappedOut).toBeUndefined()
  })

  it('flags cappedOut and drops options when over the cap', async () => {
    const find = finder({ tags: { total: 250, n: 101 } })
    const out = await enrichRelations([{ name: 'tag', type: 'relationship', relationTo: 'tags' }], find, 100)
    expect(out[0]!.cappedOut).toBe(true)
    expect(out[0]!.relationOptions).toBeUndefined()
  })

  it('enriches polymorphic relationships from every target with "<collection>:<id>" values', async () => {
    const out = await enrichRelations(
      [{ name: 'ref', type: 'relationship', relationTo: ['pages', 'posts'] }],
      finder(),
      100,
    )
    expect(out[0]!.polymorphic).toBe(true)
    expect(out[0]!.relationOptions).toEqual([
      { value: 'pages:pages-0', label: 'pages 0' },
      { value: 'pages:pages-1', label: 'pages 1' },
      { value: 'posts:posts-0', label: 'posts 0' },
      { value: 'posts:posts-1', label: 'posts 1' },
    ])
  })

  it('caps a polymorphic relationship on the SUMMED total across targets', async () => {
    const find = finder({ pages: { total: 60, n: 60 }, posts: { total: 60, n: 60 } })
    const out = await enrichRelations(
      [{ name: 'ref', type: 'relationship', relationTo: ['pages', 'posts'] }],
      find,
      100,
    )
    expect(out[0]!.cappedOut).toBe(true)
    expect(out[0]!.relationOptions).toBeUndefined()
  })

  it('leaves media relations/uploads untouched (never queried)', async () => {
    const find = finder()
    const out = await enrichRelations(
      [
        { name: 'hero', type: 'upload', relationTo: 'media', isMedia: true },
        { name: 'image', type: 'relationship', relationTo: 'media', isMedia: true },
      ],
      find,
      100,
    )
    expect(out[0]!.relationOptions).toBeUndefined()
    expect(out[1]!.relationOptions).toBeUndefined()
    expect(find).not.toHaveBeenCalled()
  })

  it('ignores non-relationship fields', async () => {
    const find = finder()
    const out = await enrichRelations(
      [{ name: 'cat', type: 'select', options: ['a', 'b'] }],
      find,
      100,
    )
    expect(out[0]).toEqual({ name: 'cat', type: 'select', options: ['a', 'b'] })
    expect(find).not.toHaveBeenCalled()
  })

  it('recurses into group fields and block fields (enrich)', async () => {
    const fields: FieldNode[] = [
      { name: 'seo', type: 'group', fields: [{ name: 'author', type: 'relationship', relationTo: 'authors' }] },
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          { slug: 'cta', fields: [{ name: 'page', type: 'relationship', relationTo: 'pages' }] },
        ],
      },
    ]
    const out = await enrichRelations(fields, finder(), 100)
    expect(out[0]!.fields![0]!.relationOptions).toHaveLength(2)
    expect(out[1]!.blocks![0]!.fields[0]!.relationOptions).toHaveLength(2)
  })
})

describe('applyRelationDefaults', () => {
  it('sets top-level and nested dotted-path defaults; no-op when undefined', () => {
    expect(applyRelationDefaults({ title: 'T' }, { author: 'a1', 'seo.author': 'a9' })).toEqual({
      title: 'T',
      author: 'a1',
      seo: { author: 'a9' },
    })
    expect(applyRelationDefaults({ title: 'T' }, undefined)).toEqual({ title: 'T' })
  })
})

describe('resolvePolymorphicValues', () => {
  const rawFields = [
    { type: 'text', name: 'title' },
    {
      type: 'group',
      name: 'link',
      fields: [
        { type: 'relationship', name: 'reference', relationTo: ['pages', 'posts'] },
        { type: 'text', name: 'label' },
      ],
    },
    { type: 'relationship', name: 'related', relationTo: ['pages'], hasMany: true },
    { type: 'relationship', name: 'author', relationTo: 'authors' },
  ]

  it('unwraps "<collection>:<id>" picks to { relationTo, value }, numeric ids restored', () => {
    const out = resolvePolymorphicValues(rawFields, {
      title: 'T',
      link: { reference: 'pages:19', label: 'Lees meer' },
      related: ['pages:7', 'pages:abc123'],
      author: 'a1',
    })
    expect((out.link as Record<string, unknown>).reference).toEqual({ relationTo: 'pages', value: 19 })
    expect(out.related).toEqual([
      { relationTo: 'pages', value: 7 },
      { relationTo: 'pages', value: 'abc123' },
    ])
    expect(out.author).toBe('a1') // monomorphic untouched
    expect(out.title).toBe('T')
  })

  it('leaves absent/odd values alone', () => {
    const out = resolvePolymorphicValues(rawFields, { title: 'T', link: { label: 'x' } })
    expect((out.link as Record<string, unknown>).reference).toBeUndefined()
  })
})

describe('filterBlocks', () => {
  it('keeps only allowlisted block slugs and recurses; no-op when allowlist empty', () => {
    const fields: FieldNode[] = [
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          { slug: 'hero', fields: [] },
          { slug: 'content', fields: [] },
          { slug: 'cta', fields: [] },
        ],
      },
    ]
    const filtered = filterBlocks(fields, ['hero', 'content'])
    expect(filtered[0]!.blocks!.map((b) => b.slug)).toEqual(['hero', 'content'])
    // empty/undefined allowlist → unchanged
    expect(filterBlocks(fields, undefined)[0]!.blocks).toHaveLength(3)
  })
})
