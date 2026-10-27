// ── completion schemas: JSON → @codemirror/lang-xml configuration ──────────
// runtime/completion_schema.py writes the JSON from an RNG, the defaults in schema/
// included (npm run schemas). It may name an attribute by a string and describe it once in
// a top-level `attributes` list.
import type { AttrSpec, ElementSpec } from '@codemirror/lang-xml';
import type { Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

export interface XmlSchema { elements: ElementSpec[]; attributes: AttrSpec[] }

interface Described { completion?: { detail?: string | null; info?: string } }
interface RawValue { label: string; detail?: string; info?: string }
interface RawAttr extends Described { name: string; values?: (string | RawValue)[] }
interface RawElement extends Described { name: string; top?: boolean; children?: string[]; attributes?: (string | RawAttr)[] }
export interface RawSchema { elements: RawElement[]; attributes?: RawAttr[] }

/** Insert `name=""` with the cursor between the quotes. */
const completeAttribute = (view: EditorView, c: Completion, from: number, to: number) =>
  view.dispatch({ changes: { from, to, insert: `${c.label}=""` }, selection: { anchor: from + c.label.length + 2 } });

const text = (detail?: string | null, info?: string): Partial<Completion> =>
  ({ ...(detail ? { detail } : {}), ...(info ? { info } : {}) });

const attribute = (a: RawAttr): AttrSpec => ({
  name: a.name,
  ...(a.values ? { values: a.values.map(v => typeof v === 'string' ? v : { label: v.label, type: 'constant', ...text(v.detail, v.info) }) } : {}),
  completion: { type: 'property', ...text(a.completion?.detail, a.completion?.info), apply: completeAttribute },
});

/** Turn the JSON into lang-xml's configuration, attributes inserted with their quotes. */
export function completionSchema(json: RawSchema): XmlSchema {
  return {
    elements: json.elements.map(e => ({
      name: e.name,
      children: e.children,
      top: !!e.top,
      completion: { type: 'type', ...text(e.completion?.detail, e.completion?.info) },
      attributes: (e.attributes ?? []).map(a => typeof a === 'string' ? a : attribute(a)),
    })),
    attributes: (json.attributes ?? []).map(attribute),
  };
}
