import type { FieldNode } from './types'

// Raw (sanitized) Payload field — structurally typed so this stays unit-testable without the payload
// package. Crucially it KEEPS `admin.condition` (a function), which the JSON walker strips.
export interface RawField {
  type: string
  name?: string
  required?: boolean
  relationTo?: string | string[]
  options?: Array<string | { value: string }>
  admin?: { condition?: (...args: unknown[]) => unknown }
  fields?: RawField[]
  tabs?: Array<{ name?: string; fields: RawField[] }>
  blocks?: Array<{ slug: string; fields: RawField[] }>
}

// Evaluate a field's admin.condition for a candidate sibling-data object → is the field SHOWN
// (and thus validated/required)? Injected so tests don't need Payload. Conservative on throw: true.
export type ConditionEvaluator = (
  condition: (...args: unknown[]) => unknown,
  siblingData: Record<string, unknown>,
) => boolean

function isUnfillableMedia(f: RawField, media: string[]): boolean {
  if (f.type === 'upload') return true
  if (f.type === 'relationship') {
    const targets = Array.isArray(f.relationTo) ? f.relationTo : f.relationTo ? [f.relationTo] : []
    return targets.some((t) => media.includes(t))
  }
  return false
}

// Condition-aware constraining: walk the RAW field tree (which still has admin.condition) in
// parallel with the serialized nodes and, per scope, handle REQUIRED unfillable media fields:
//  - if a sibling select/radio toggles the field's condition off, restrict that select to the safe
//    option values (so the AI can only pick variants that don't need the upload);
//  - else mark the enclosing group/array/block `unsatisfiable` (the app drops or escalates it).
// Returns whether THIS scope is blocked (propagates up through required containers). Generic: no
// field names or page structure assumed — driven entirely by Payload's own conditions.
export function constrainByConditions(
  rawFields: RawField[],
  nodes: FieldNode[],
  media: string[],
  evalCondition: ConditionEvaluator,
): boolean {
  const nodeByName = new Map<string, FieldNode>()
  for (const n of nodes) if (n.name) nodeByName.set(n.name, n)

  // Flatten presentational containers into this scope; recurse named containers; collect this
  // scope's data-bearing raw fields.
  const scope: RawField[] = []
  const collect = (fields: RawField[]): void => {
    for (const rf of fields) {
      if (rf.type === 'tabs' && rf.tabs) {
        for (const tab of rf.tabs) {
          if (tab.name) {
            const node = nodeByName.get(tab.name)
            if (node?.fields && constrainByConditions(tab.fields, node.fields, media, evalCondition)) {
              node.unsatisfiable = true
            }
          } else {
            collect(tab.fields)
          }
        }
        continue
      }
      if (!rf.name && rf.fields) {
        collect(rf.fields) // presentational container (row/collapsible/unnamed group)
        continue
      }
      scope.push(rf)

      if ((rf.type === 'group' || rf.type === 'array') && rf.fields && rf.name) {
        const node = nodeByName.get(rf.name)
        if (node?.fields && constrainByConditions(rf.fields, node.fields, media, evalCondition)) {
          node.unsatisfiable = true
        }
      } else if (rf.type === 'blocks' && rf.blocks && rf.name) {
        const node = nodeByName.get(rf.name)
        if (node?.blocks) {
          for (const rb of rf.blocks) {
            const nb = node.blocks.find((b) => b.slug === rb.slug)
            if (nb && constrainByConditions(rb.fields, nb.fields, media, evalCondition)) {
              nb.unsatisfiable = true
            }
          }
        }
      }
    }
  }
  collect(rawFields)

  let blocked = false

  // Required, unfillable media fields in this scope.
  const blockers = scope.filter((f) => f.required && isUnfillableMedia(f, media))
  for (const blocker of blockers) {
    const cond = blocker.admin?.condition
    if (!cond) {
      blocked = true // unconditionally required upload → can never satisfy text-only
      continue
    }
    // Try to restrict a sibling select/radio to values that turn the condition off.
    let escaped = false
    for (const sel of scope) {
      if (sel.type !== 'select' && sel.type !== 'radio') continue
      const selNode = sel.name ? nodeByName.get(sel.name) : undefined
      if (!selNode?.options?.length) continue
      const safe = selNode.options.filter((v) => !evalCondition(cond, { [sel.name!]: v }))
      if (safe.length > 0) {
        selNode.options = safe
        escaped = true
      }
    }
    if (!escaped) blocked = true
  }

  // A required child container we already marked unsatisfiable blocks this scope too.
  for (const rf of scope) {
    if (rf.required && rf.name && nodeByName.get(rf.name)?.unsatisfiable) blocked = true
  }

  return blocked
}
