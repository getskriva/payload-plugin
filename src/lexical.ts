import { convertMarkdownToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import type { Field, RichTextField } from 'payload'
import type { RichTextConverter } from './richtext'

// The real markdown→Lexical converter: uses each richText field's OWN editorConfig (its enabled
// features), so the output matches what that field renders. Kept separate from richtext.ts so the
// recursion logic stays unit-testable without the @payloadcms/richtext-lexical peer dependency.
export const lexicalConverter: RichTextConverter = (field: Field, markdown: string) =>
  convertMarkdownToLexical({
    editorConfig: editorConfigFactory.fromField({ field: field as RichTextField }),
    markdown,
  })
