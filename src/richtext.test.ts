import { describe, it, expect } from 'vitest'
import { convertRichText, type RichTextConverter } from './richtext'
import type { Field } from 'payload'

// Fake converter: marks a value so we can assert it was converted, without the lexical peer dep.
const convert: RichTextConverter = (_field, markdown) => ({ lexical: markdown })

// Helper to cast plain test fixtures to the payload Field[] shape.
const F = (fields: unknown[]) => fields as unknown as Field[]

describe('convertRichText', () => {
  it('converts a top-level richText slot', () => {
    expect(convertRichText(F([{ type: 'richText', name: 'body' }]), { body: '# Hi' }, convert)).toEqual({
      body: { lexical: '# Hi' },
    })
  })

  it('leaves non-richText values and unmapped keys untouched', () => {
    const out = convertRichText(F([{ type: 'text', name: 'title' }]), { title: 'T', extra: 1 }, convert)
    expect(out).toEqual({ title: 'T', extra: 1 })
  })

  it('recurses into a named group', () => {
    const fields = F([{ type: 'group', name: 'seo', fields: [{ type: 'richText', name: 'body' }] }])
    expect(convertRichText(fields, { seo: { body: 'x' } }, convert)).toEqual({
      seo: { body: { lexical: 'x' } },
    })
  })

  it('recurses into an array of rows', () => {
    const fields = F([{ type: 'array', name: 'cols', fields: [{ type: 'richText', name: 'body' }] }])
    const out = convertRichText(fields, { cols: [{ body: 'a' }, { body: 'b' }] }, convert)
    expect(out).toEqual({ cols: [{ body: { lexical: 'a' } }, { body: { lexical: 'b' } }] })
  })

  it('recurses into blocks by blockType and preserves blockType', () => {
    const fields = F([
      {
        type: 'blocks',
        name: 'layout',
        blocks: [
          { slug: 'text', fields: [{ type: 'array', name: 'columns', fields: [{ type: 'richText', name: 'body' }] }] },
          { slug: 'hero', fields: [{ type: 'richText', name: 'intro' }] },
        ],
      },
    ])
    const data = {
      layout: [
        { blockType: 'text', columns: [{ body: 'one' }, { body: 'two' }] },
        { blockType: 'hero', intro: 'hi' },
      ],
    }
    expect(convertRichText(fields, data, convert)).toEqual({
      layout: [
        { blockType: 'text', columns: [{ body: { lexical: 'one' } }, { body: { lexical: 'two' } }] },
        { blockType: 'hero', intro: { lexical: 'hi' } },
      ],
    })
  })

  it('leaves an unknown blockType item untouched', () => {
    const fields = F([{ type: 'blocks', name: 'layout', blocks: [{ slug: 'text', fields: [{ type: 'richText', name: 'body' }] }] }])
    const data = { layout: [{ blockType: 'nope', body: 'x' }] }
    expect(convertRichText(fields, data, convert)).toEqual(data)
  })

  it('handles named and unnamed tabs', () => {
    const fields = F([
      {
        type: 'tabs',
        tabs: [
          { name: 'content', fields: [{ type: 'richText', name: 'body' }] },
          { label: 'Meta', fields: [{ type: 'richText', name: 'intro' }] },
        ],
      },
    ])
    const out = convertRichText(fields, { content: { body: 'a' }, intro: 'b' }, convert)
    expect(out).toEqual({ content: { body: { lexical: 'a' } }, intro: { lexical: 'b' } })
  })
})
