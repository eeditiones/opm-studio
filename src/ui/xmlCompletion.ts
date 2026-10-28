// ── autocompletion from the document's schema, as the schema worker answers it ──
import { startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { Suggestion } from '../runtime/complete.ts';
import type { Schema } from './xmlSchema.ts';

/** Insert `name=""` with the cursor between the quotes, and offer the attribute's values. */
function insertAttribute(view: EditorView, c: Completion, from: number, to: number): void {
  view.dispatch({ changes: { from, to, insert: `${c.label}=""` }, selection: { anchor: from + c.label.length + 2 } });
  startCompletion(view);
}

/** Between tags there is no '<' yet: write the whole element, the cursor inside it. */
function insertElement(view: EditorView, c: Completion, from: number, to: number): void {
  view.dispatch({ changes: { from, to, insert: `<${c.label}></${c.label}>` }, selection: { anchor: from + c.label.length + 2 } });
}

const TYPES = { element: 'type', attribute: 'property', value: 'constant' } as const;

function completion(s: Suggestion, inTag: boolean): Completion {
  return {
    label: s.label, type: TYPES[s.kind],
    ...(s.detail ? { detail: s.detail } : {}), ...(s.info ? { info: s.info } : {}),
    ...(s.kind === 'attribute' ? { apply: insertAttribute } : s.kind === 'element' && !inTag ? { apply: insertElement } : {}),
  };
}

/** Whether the cursor is inside a tag, judged from the text just before it, as complete.ts does in full. */
function inTag(context: CompletionContext): boolean {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 4000), context.pos);
  return before.lastIndexOf('<') > before.lastIndexOf('>');
}

/** Suggestions in a tag as you type, and between tags on request (Ctrl+Space). */
export function schemaCompletion(schema: Schema): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    if (!context.explicit && !inTag(context)) return null;
    let r;
    try { r = await schema.complete(context.state.doc.toString(), context.pos); }
    catch (e) { console.warn('Autocompletion is off:', e); return null; }
    if (!r || !r.suggestions.length || context.aborted) return null;
    // names and values grow by these characters without asking the worker again
    return { from: r.from, options: r.suggestions.map(s => completion(s, r.inTag)), validFor: /^[\w.:-]*$/ };
  };
}
