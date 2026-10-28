// ── which schema an XML file gets, for completion and for validation ──────
// 1. an RNG in the project named by the file's <?xml-model?>, or by [editor] schema in opm.toml,
//    which may also name the JSON runtime/completion_schema.py wrote from one (completion only)
// 2. for TEI, DocBook and JATS, the whole of their schema (schema/<name>.json and
//    <name>.salve.json, fetched once; npm run schemas writes them)
import { completionFromRng } from '../runtime/opm.ts';
import { validateText, type Problem, type SchemaSource } from '../runtime/validation.ts';
import { config, dirOf, exists, normPath, projectFiles, readText } from '../project/fs.ts';
import { tomlString } from '../project/toml.ts';
import { on, state } from '../state.ts';
import { completionSchema, type XmlSchema } from './completionSchema.ts';

/** The vocabulary of a document by namespace, root element or doctype; '' for none we know. */
function vocabulary(text: string): string {
  const head = text.slice(0, 5000);
  if (head.includes('http://www.tei-c.org/ns/1.0') || /<(TEI|teiCorpus)[\s>]/.test(head)) return 'tei';
  if (head.includes('http://docbook.org/ns/docbook')) return 'docbook';
  // JATS has no namespace: its doctype, or an <article> without one (DocBook's has its own)
  // that says it is JATS by @dtd-version, @article-type or its <front>
  if (/<!DOCTYPE\s+article\s+PUBLIC\s+"-\/\/NLM\/\/DTD/.test(head)) return 'jats';
  const article = head.match(/<article(?=[\s>])[^>]*>/)?.[0];
  if (article && !/\sxmlns\s*=/.test(article) && (/\s(dtd-version|article-type)\s*=/.test(article) || /<front[\s>]/.test(head))) return 'jats';
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
/** Goes up with every such change, so the validation worker reads project RNGs afresh. */
let generation = 0;
const changed = () => { fromProject.clear(); generation++; };
on(['project', 'files', 'config'], changed);
on('edit', () => { if (/\.(rng|json)$/i.test(state.file)) changed(); });

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

/** A default grammar for validation, as JSON text. */
const salveJson = (name: string): Promise<SchemaSource> =>
  fetch(new URL(`schema/${name}.salve.json`, document.baseURI))
    .then(r => { if (!r.ok) throw new Error(`schema/${name}.salve.json could not be loaded: ${r.status}`); return r.text(); })
    .then(json => ({ json }));

/** A project RNG, with every RNG in the project for its include and externalRef to find. */
function projectRng(file: string): Promise<SchemaSource> {
  const files: Record<string, string> = {};
  for (const f of projectFiles()) if (/\.rng$/i.test(f)) files[f] = readText(f);
  return Promise.resolve({ main: file, files });
}

/** A check of file p's text against its RELAX NG schema, or null when it has none. */
export function validatorFor(p: string, text: string): ((text: string) => Promise<Problem[]>) | null {
  const file = schemaFile(p, text);
  if (/\.rng$/i.test(file)) {
    const key = `${state.dir}/${file}#${generation}`;
    return t => validateText(key, () => projectRng(file), t);
  }
  const name = vocabulary(text);
  if (!name) return null;
  return t => validateText(`default:${name}`, () => salveJson(name), t);
}
