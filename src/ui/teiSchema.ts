// ── TEI schema for autocompletion in the source editor ────────────────────
// schema/tei.json describes the full TEI schema in the form @codemirror/lang-xml
// takes (from jinn-codemirror). It is large, so it is fetched only once a TEI file is opened.
import type { ElementSpec } from '@codemirror/lang-xml';
import type { Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

/** Root elements offered in an empty document, instead of every element. */
const TOP = new Set(['TEI', 'teiCorpus']);

interface Described { completion?: { detail?: string | null; info?: string } }
interface RawElement extends Described { name: string; children?: string[]; attributes?: (Described & { name: string })[] }

/** Insert `name=""` with the cursor between the quotes. */
const completeAttribute = (view: EditorView, c: Completion, from: number, to: number) =>
  view.dispatch({ changes: { from, to, insert: `${c.label}=""` }, selection: { anchor: from + c.label.length + 2 } });

const describe = ({ completion: c }: Described): Partial<Completion> =>
  c ? { ...(c.detail ? { detail: c.detail } : {}), ...(c.info ? { info: c.info } : {}) } : {};

/** Turn the JSON into element specs: root elements marked, attributes inserted with their quotes. */
export function teiElements(json: { elements: RawElement[] }): ElementSpec[] {
  return json.elements.map(e => ({
    name: e.name,
    children: e.children,
    top: TOP.has(e.name),
    completion: { type: 'type', ...describe(e) },
    attributes: (e.attributes ?? []).map(a => ({ name: a.name, completion: { type: 'property', ...describe(a), apply: completeAttribute } })),
  }));
}

let schema: Promise<ElementSpec[]> | null = null;

/** The TEI element specs, fetched once; empty if the file cannot be loaded, so editing goes on without completion. */
export function loadTeiSchema(): Promise<ElementSpec[]> {
  schema ??= fetch(new URL('schema/tei.json', document.baseURI))
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(teiElements)
    .catch(e => { console.warn('TEI autocompletion is off: schema/tei.json could not be loaded:', e); schema = null; return []; });
  return schema;
}
