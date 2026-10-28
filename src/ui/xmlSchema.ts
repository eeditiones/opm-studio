// ── which RELAX NG schema an XML file gets, for validation and completion ──
// 1. an RNG in the project named by the file's <?xml-model?>, or by [editor] schema in opm.toml
// 2. for TEI, DocBook and JATS, the whole of their schema (schema/<name>/, npm run schemas
//    downloads them)
// The worker (runtime/validator.ts) turns either into a grammar once and keeps it.
import { possibleAt, validateText, type Possible, type Problem, type SchemaSource } from '../runtime/validation.ts';
import { config, dirOf, exists, normPath, projectFiles, readText } from '../project/fs.ts';
import { tomlString } from '../project/toml.ts';
import { on, state } from '../state.ts';

/** What the editor asks of a document's schema. */
export interface Schema {
  validate(text: string): Promise<Problem[]>;
  complete(text: string, at: number): Promise<Possible | null>;
}

/** The main file of each default schema below schema/, as scripts/schemas.py downloads it. */
const DEFAULTS: Record<string, string> = {
  tei: 'tei/tei_all.rng',
  docbook: 'docbook/docbook.rng',
  jats: 'jats/JATS-archivearticle1-3-mathml3.rng',
};

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

/** Goes up whenever project files may have changed, so the worker reads project RNGs afresh. */
let generation = 0;
on(['project', 'files', 'config'], () => generation++);
on('edit', () => { if (/\.rng$/i.test(state.file)) generation++; });

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
  return configured && /\.rng$/i.test(configured) && exists(configured) ? configured : '';
}

/** A project RNG, with every RNG in the project for its include and externalRef to find. */
function projectRng(file: string): Promise<SchemaSource> {
  const files: Record<string, string> = {};
  for (const f of projectFiles()) if (/\.rng$/i.test(f)) files[f] = readText(f);
  return Promise.resolve({ main: file, files });
}

/** The schema of XML file p, or null when it has none. */
export function schemaFor(p: string, text: string): Schema | null {
  const file = schemaFile(p, text), name = vocabulary(text);
  if (!file && !DEFAULTS[name]) return null;
  const key = file ? `${state.dir}/${file}#${generation}` : `default:${name}`;
  const source = file
    ? () => projectRng(file)
    : () => Promise.resolve({ url: new URL(`schema/${DEFAULTS[name]}`, document.baseURI).href });
  return {
    validate: t => validateText(key, source, t),
    complete: (t, at) => possibleAt(key, source, t, at),
  };
}
