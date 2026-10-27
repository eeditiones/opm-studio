// ── which completion schema an XML file gets ──────────────────────────────
// 1. an RNG in the project named by the file's <?xml-model?>, or by [editor] schema in opm.toml,
//    which may also name the JSON runtime/completion_schema.py wrote from one
// 2. for TEI, DocBook and JATS, the whole of their schema (schema/<name>.json, fetched once;
//    npm run schemas writes them)
import { completionFromRng } from '../runtime/opm.ts';
import { config, dirOf, exists, normPath, readText } from '../project/fs.ts';
import { tomlString } from '../project/toml.ts';
import { on, state } from '../state.ts';
import { completionSchema, type XmlSchema } from './completionSchema.ts';

/** The vocabulary of a document by namespace, root element or doctype; '' for none we know. */
function vocabulary(text: string): string {
  const head = text.slice(0, 5000);
  if (head.includes('http://www.tei-c.org/ns/1.0') || /<(TEI|teiCorpus)[\s>]/.test(head)) return 'tei';
  if (head.includes('http://docbook.org/ns/docbook')) return 'docbook';
  // JATS has no namespace: its doctype, or the dtd-version on its root
  if (/<!DOCTYPE\s+article\s+PUBLIC\s+"-\/\/NLM\/\/DTD/.test(head) || /<article\s[^>]*\bdtd-version=/.test(head)) return 'jats';
  return '';
}

const builtin = new Map<string, Promise<XmlSchema | null>>();
function fullSchema(name: string): Promise<XmlSchema | null> {
  if (!name) return Promise.resolve(null);
  let s = builtin.get(name);
  if (!s) {
    s = fetch(new URL(`schema/${name}.json`, document.baseURI))
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(completionSchema)
      .catch(e => { console.warn(`Autocompletion is off: schema/${name}.json could not be loaded:`, e); builtin.delete(name); return null; });
    builtin.set(name, s);
  }
  return s;
}

/** Schemas read from project files; dropped whenever project files may have changed. */
const fromProject = new Map<string, Promise<XmlSchema | null>>();
on(['project', 'files', 'config'], () => fromProject.clear());
on('edit', () => { if (/\.(rng|json)$/i.test(state.file)) fromProject.clear(); });

/** The schema file for file p: an RNG from its own <?xml-model?> first, then opm.toml's [editor] schema. */
function schemaFile(p: string, text: string): string {
  for (const [, pi] of text.slice(0, 5000).matchAll(/<\?xml-model\s([^?]*)\?>/g)) {
    const href = pi.match(/\bhref\s*=\s*["']([^"']+)["']/)?.[1];
    // remote schemas, and Schematron pointed at with the same PI, are left alone
    if (!href || !/\.rng$/i.test(href) || /^[a-z][\w+.-]*:/i.test(href) || /schematron/i.test(pi)) continue;
    const path = normPath(dirOf(p) + href);
    if (exists(path)) return path;
  }
  const configured = normPath(tomlString(config(), 'editor', 'schema'));
  return configured && /\.(rng|json)$/i.test(configured) && exists(configured) ? configured : '';
}

/** The completion schema for the XML file p, or null for plain XML. */
export function schemaFor(p: string, text: string): Promise<XmlSchema | null> {
  const file = schemaFile(p, text);
  if (file) {
    let s = fromProject.get(file);
    if (!s) {
      // after the editor has painted: a large grammar takes a moment to read
      s = new Promise<XmlSchema | null>(resolve => setTimeout(() => {
        try { resolve(completionSchema(/\.json$/i.test(file) ? JSON.parse(readText(file)) : completionFromRng(state.dir, file))); }
        catch (e) { console.warn(`No autocompletion from ${file}:`, e); resolve(null); }
      }, 50));
      fromProject.set(file, s);
    }
    return s.then(r => r ?? fullSchema(vocabulary(text)));
  }
  return fullSchema(vocabulary(text));
}
