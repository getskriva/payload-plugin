import { describe, it, expect } from 'vitest'
import { serializeFields, type RawField } from './walker'

const MEDIA = ['media', 'images']

describe('serializeFields', () => {
  it('serializes a scalar text field with name/type/required', () => {
    const fields: RawField[] = [{ type: 'text', name: 'title', required: true }]
    expect(serializeFields(fields, MEDIA)).toEqual([{ name: 'title', type: 'text', required: true }])
  })

  it('flags a richText field as a markdown slot', () => {
    const out = serializeFields([{ type: 'richText', name: 'body' }], MEDIA)
    expect(out[0]).toMatchObject({ name: 'body', type: 'richText', isRichText: true })
  })

  it('normalizes select options to value strings', () => {
    const out = serializeFields(
      [{ type: 'select', name: 'cat', options: ['news', { label: 'Guides', value: 'guides' }] }],
      MEDIA,
    )
    expect(out[0]).toMatchObject({ name: 'cat', type: 'select', options: ['news', 'guides'] })
  })

  it('marks upload fields as media (always skippable in v1)', () => {
    const out = serializeFields([{ type: 'upload', name: 'hero', relationTo: 'media' }], MEDIA)
    expect(out[0]).toMatchObject({ name: 'hero', type: 'upload', isMedia: true })
  })

  it('marks a relationship to a media collection as media, but not other relationships', () => {
    const out = serializeFields(
      [
        { type: 'relationship', name: 'image', relationTo: 'images' },
        { type: 'relationship', name: 'related', relationTo: 'posts', hasMany: true },
      ],
      MEDIA,
    )
    expect(out[0]).toMatchObject({ name: 'image', isMedia: true })
    expect(out[1]).toMatchObject({ name: 'related', relationTo: 'posts', hasMany: true })
    expect(out[1].isMedia).toBeUndefined()
  })

  it('recurses into a named group', () => {
    const out = serializeFields(
      [{ type: 'group', name: 'seo', fields: [{ type: 'text', name: 'metaTitle' }] }],
      MEDIA,
    )
    expect(out[0]).toMatchObject({
      name: 'seo',
      type: 'group',
      fields: [{ name: 'metaTitle', type: 'text' }],
    })
  })

  it('recurses into blocks, recording each block slug + its fields', () => {
    const out = serializeFields(
      [
        {
          type: 'blocks',
          name: 'layout',
          blocks: [{ slug: 'hero', fields: [{ type: 'text', name: 'heading' }] }],
        },
      ],
      MEDIA,
    )
    expect(out[0]).toMatchObject({
      name: 'layout',
      type: 'blocks',
      blocks: [{ slug: 'hero', fields: [{ name: 'heading', type: 'text' }] }],
    })
  })

  it('keeps a plain-string block labels.singular as the block label; drops fn/i18n labels', () => {
    const out = serializeFields(
      [
        {
          type: 'blocks',
          name: 'layout',
          blocks: [
            { slug: 'faq', labels: { singular: 'FAQ', plural: 'FAQs' }, fields: [] },
            { slug: 'text', labels: { singular: () => 'Text' }, fields: [] },
            { slug: 'bare', fields: [] },
          ],
        },
      ],
      MEDIA,
    )
    const blocks = (out[0] as { blocks: Array<{ slug: string; label?: string }> }).blocks
    expect(blocks[0]).toMatchObject({ slug: 'faq', label: 'FAQ' })
    expect(blocks[1]!.label).toBeUndefined()
    expect(blocks[2]!.label).toBeUndefined()
  })

  it('skips Payload-internal underscore fields (_status)', () => {
    const out = serializeFields(
      [
        { type: 'text', name: 'title' },
        { type: 'select', name: '_status', options: ['draft', 'published'] },
      ],
      MEDIA,
    )
    expect(out.map((f) => f.name)).toEqual(['title'])
  })

  it('flattens presentational rows into the parent list', () => {
    const out = serializeFields(
      [{ type: 'row', fields: [{ type: 'text', name: 'a' }, { type: 'text', name: 'b' }] }],
      MEDIA,
    )
    expect(out.map((f) => f.name)).toEqual(['a', 'b'])
  })

  it('handles named vs unnamed tabs (named → group node, unnamed → flattened)', () => {
    const out = serializeFields(
      [
        {
          type: 'tabs',
          tabs: [
            { name: 'content', fields: [{ type: 'richText', name: 'body' }] },
            { label: 'Meta', fields: [{ type: 'text', name: 'metaTitle' }] },
          ],
        },
      ],
      MEDIA,
    )
    expect(out.find((f) => f.name === 'content')).toMatchObject({ type: 'group' })
    expect(out.find((f) => f.name === 'metaTitle')).toBeTruthy() // unnamed tab flattened
  })

  it('drops function-valued labels (never serialize functions) and skips ui/join fields', () => {
    const out = serializeFields(
      [
        { type: 'text', name: 'x', label: () => 'Dynamic' as unknown as string },
        { type: 'ui', name: 'sidebar' },
        { type: 'join', name: 'comments' },
      ],
      MEDIA,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ name: 'x', type: 'text' }) // label omitted (was a function)
  })

  it('keeps a string label', () => {
    const out = serializeFields([{ type: 'text', name: 'x', label: 'Title' }], MEDIA)
    expect(out[0]).toMatchObject({ label: 'Title' })
  })
})
