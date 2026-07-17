// Wire contract for the plugin. Kept in sync with the Skriva app's connector types.
//
// IMPORTANT: these types MUST stay identical to the wire-contract block in the app repo at
// the Skriva app (app/server/connectors/types.ts). There is no shared npm package yet; keep both in sync.

// One node of the target collection's (recursively serialized) field tree, returned by GET /schema.
export interface FieldNode {
  name: string
  type: string
  required?: boolean
  label?: string
  isRichText?: boolean // markdown-slot: the plugin runs convertMarkdownToLexical on the value
  isMedia?: boolean // relationship/upload to a media collection → skipped in v1 (text-only)
  hasMany?: boolean
  relationTo?: string | string[]
  options?: string[]
  relationOptions?: { value: string; label: string }[] // non-media relation candidates (cap 100)
  cappedOut?: boolean // relationship had >100 candidates → skipped
  polymorphic?: boolean // relationTo is an array (multi-target) → relationOptions use "<collection>:<id>" values
  // a group/array/block whose required subtree needs an unfillable field (media/required-relation)
  // that can't be avoided via a sibling option → the app drops it (optional) or needs-attention.
  unsatisfiable?: boolean
  fields?: FieldNode[]
  blocks?: { slug: string; label?: string; fields: FieldNode[]; unsatisfiable?: boolean }[]
}

export interface SchemaResponse {
  slug: string
  label?: string
  useAsTitle?: string
  fields: FieldNode[]
}

// The plugin owns the target + auth collection (configured in payload.config). The app discovers the
// target here and only stores base URL + API key (+ the auth slug, which it needs to authenticate).
export interface ManifestResponse {
  ok: true
  targetCollection: string
  label?: string
  authCollection: string
}

// The publish payload: a mapped field tree. richText fields carry MARKDOWN strings; the plugin owns
// the markdown→Lexical conversion. The collection is NOT sent — the plugin uses its configured target.
export interface PublishRequest {
  slug: string
  externalId?: string
  status: 'draft' | 'published'
  data: Record<string, unknown>
}

export interface PublishResponse {
  externalId: string
  url: string
}
