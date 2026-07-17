import type { FieldNode } from './types.js'

// A structurally-typed slice of a Payload (sanitized) field config — enough for serialization,
// without depending on `payload` at test time. The real handler passes the sanitized fields in.
export interface RawField {
  type: string
  name?: string
  required?: boolean
  label?: unknown // string | function | object — we only keep plain strings
  hasMany?: boolean
  relationTo?: string | string[]
  options?: Array<string | { value: string; label?: unknown }>
  fields?: RawField[]
  tabs?: Array<{ name?: string; label?: unknown; fields: RawField[] }>
  blocks?: Array<{ slug: string; labels?: unknown; fields: RawField[] }>
}

// Presentational wrappers carry no data key — their children flatten into the parent list.
const FLATTEN = new Set(['row', 'collapsible'])
// Not author-set content — never exposed.
const SKIP = new Set(['ui', 'join'])

function stringLabel(label: unknown): string | undefined {
  return typeof label === 'string' ? label : undefined
}

// Block `labels` is { singular, plural } where each may be a string, function or i18n object —
// we only keep a plain-string singular (the AI's signal for what the block is for).
function blockLabel(labels: unknown): string | undefined {
  if (!labels || typeof labels !== 'object') return undefined
  return stringLabel((labels as { singular?: unknown }).singular)
}

function isMedia(relationTo: string | string[] | undefined, mediaCollections: string[]): boolean {
  if (!relationTo) return false
  const targets = Array.isArray(relationTo) ? relationTo : [relationTo]
  return targets.some((t) => mediaCollections.includes(t))
}

function normalizeOptions(options: RawField['options']): string[] | undefined {
  if (!options) return undefined
  return options.map((o) => (typeof o === 'string' ? o : o.value))
}

// Recursively serialize a Payload field tree to JSON-safe FieldNodes. This is the manifest's core:
// it picks ONLY data-bearing shape and drops every function (validate/hooks/access/fn-labels) —
// which is why we never JSON.stringify(payload.config) directly (functions + circular refs).
export function serializeFields(fields: RawField[], mediaCollections: string[]): FieldNode[] {
  const out: FieldNode[] = []

  for (const field of fields) {
    if (SKIP.has(field.type)) continue
    // Payload-internal fields (_status from drafts, etc.) — never author-set content.
    if (typeof field.name === 'string' && field.name.startsWith('_')) continue

    // Presentational containers: flatten children up.
    if (FLATTEN.has(field.type) && field.fields) {
      out.push(...serializeFields(field.fields, mediaCollections))
      continue
    }

    // Tabs: named tab → group node; unnamed tab → flatten its fields.
    if (field.type === 'tabs' && field.tabs) {
      for (const tab of field.tabs) {
        if (tab.name) {
          out.push({
            name: tab.name,
            type: 'group',
            ...(stringLabel(tab.label) ? { label: stringLabel(tab.label) } : {}),
            fields: serializeFields(tab.fields, mediaCollections),
          })
        } else {
          out.push(...serializeFields(tab.fields, mediaCollections))
        }
      }
      continue
    }

    // Unnamed group → flatten; named group/array → recurse under the name.
    if ((field.type === 'group' || field.type === 'array') && field.fields) {
      if (!field.name) {
        out.push(...serializeFields(field.fields, mediaCollections))
        continue
      }
      out.push({
        name: field.name,
        type: field.type,
        ...(field.required ? { required: true } : {}),
        ...(stringLabel(field.label) ? { label: stringLabel(field.label) } : {}),
        fields: serializeFields(field.fields, mediaCollections),
      })
      continue
    }

    // Blocks: record each block slug + its (recursively serialized) fields.
    if (field.type === 'blocks' && field.name) {
      out.push({
        name: field.name,
        type: 'blocks',
        ...(field.required ? { required: true } : {}),
        ...(stringLabel(field.label) ? { label: stringLabel(field.label) } : {}),
        blocks: (field.blocks ?? []).map((b) => ({
          slug: b.slug,
          ...(blockLabel(b.labels) ? { label: blockLabel(b.labels) } : {}),
          fields: serializeFields(b.fields, mediaCollections),
        })),
      })
      continue
    }

    // Data-bearing leaf fields.
    if (!field.name) continue

    const node: FieldNode = { name: field.name, type: field.type }
    if (field.required) node.required = true
    const label = stringLabel(field.label)
    if (label) node.label = label
    if (field.type === 'richText') node.isRichText = true
    if (field.hasMany) node.hasMany = true

    if (field.type === 'relationship' || field.type === 'upload') {
      if (field.relationTo) node.relationTo = field.relationTo
      // uploads always point at a media collection; relationships only if relationTo ∈ media list.
      if (field.type === 'upload' || isMedia(field.relationTo, mediaCollections)) node.isMedia = true
    }

    const options = normalizeOptions(field.options)
    if (options) node.options = options

    out.push(node)
  }

  return out
}
