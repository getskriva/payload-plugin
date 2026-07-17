import type { Field } from 'payload'

// Converts a single richText field's markdown to Lexical. Injected so this module stays free of the
// (heavy, peer-only) lexical import and is unit-testable; the real impl lives in ./lexical.
export type RichTextConverter = (field: Field, markdown: string) => unknown

type AnyData = Record<string, unknown>

// Per-field visitor for transformFieldData: return the replacement value, or undefined to keep the
// value as-is (containers are then recursed into by the walker).
export type FieldDataVisitor = (field: AnyData, value: unknown) => unknown

// Recursively walk `data` in parallel with the field config — top level and inside groups, arrays,
// blocks and tabs, to any depth — applying `visit` to every named field's value. Generic: no
// assumptions about field names or page structure, so it works for any collection. Shared by the
// markdown→Lexical conversion and the polymorphic-relationship unwrapping at publish.
export function transformFieldData(
  fields: AnyData[],
  data: AnyData,
  visit: FieldDataVisitor,
): AnyData {
  const out: AnyData = { ...data }

  for (const field of fields) {
    // tabs: each tab is named (data nested under tab.name) or unnamed (flattened into the parent).
    if (field.type === 'tabs' && Array.isArray(field.tabs)) {
      for (const tab of field.tabs as AnyData[]) {
        if (tab.name) {
          const v = out[tab.name as string]
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            out[tab.name as string] = transformFieldData(tab.fields as AnyData[], v as AnyData, visit)
          }
        } else {
          Object.assign(out, transformFieldData(tab.fields as AnyData[], out, visit))
        }
      }
      continue
    }

    // Presentational / unnamed containers (row, collapsible, unnamed group): children at parent level.
    if (!field.name) {
      if (Array.isArray(field.fields)) {
        Object.assign(out, transformFieldData(field.fields as AnyData[], out, visit))
      }
      continue
    }

    const name = field.name as string
    const value = out[name]

    const visited = visit(field, value)
    if (visited !== undefined) {
      out[name] = visited
      continue
    }

    if (
      field.type === 'group' &&
      Array.isArray(field.fields) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[name] = transformFieldData(field.fields as AnyData[], value as AnyData, visit)
    } else if (field.type === 'array' && Array.isArray(field.fields) && Array.isArray(value)) {
      out[name] = (value as unknown[]).map((item) =>
        item && typeof item === 'object'
          ? transformFieldData(field.fields as AnyData[], item as AnyData, visit)
          : item,
      )
    } else if (field.type === 'blocks' && Array.isArray(field.blocks) && Array.isArray(value)) {
      out[name] = (value as unknown[]).map((item) => {
        if (!item || typeof item !== 'object') return item
        const blockType = (item as AnyData).blockType
        const block = (field.blocks as AnyData[]).find((b) => b.slug === blockType)
        return block ? transformFieldData(block.fields as AnyData[], item as AnyData, visit) : item
      })
    }
  }

  return out
}

// Convert EVERY richText markdown slot in `data` to Lexical. The app sends markdown; the plugin
// owns the conversion.
export function convertRichText(
  fields: Field[],
  data: AnyData,
  convert: RichTextConverter,
): AnyData {
  return transformFieldData(fields as unknown as AnyData[], data, (field, value) =>
    field.type === 'richText' && typeof value === 'string'
      ? convert(field as unknown as Field, value)
      : undefined,
  )
}
