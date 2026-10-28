// ── what the schema allows at the cursor, from salve's walker ─────────────
// Pure, like validate.ts: the worker (runtime/validator.ts) runs it, tests call it directly.
// The text before the cursor is fed to the walker, which then knows what may come next,
// in document order: after <TEI> only <teiHeader>, inside <hi only its attributes.
import { DefaultNameResolver, Name, NameChoice, type BaseName, type Grammar } from 'salve-annos';
import { SaxesParser, type SaxesTagNS } from 'saxes';

export interface Suggestion { kind: 'element' | 'attribute' | 'value'; label: string; detail?: string; info?: string }
/** Suggestions for the text from `from` to the cursor; `inTag` is false between tags, where they are only offered on request. */
export interface Possible { from: number; inTag: boolean; suggestions: Suggestion[] }

/** A detail longer than this is cut at a word. */
const DETAIL_MAX = 80;

/**
 * detail and info from an a:documentation. TEI's open with the gloss in parentheses,
 * "(paragraph) marks paragraphs in prose. [3.1. Paragraphs]": the gloss becomes the detail,
 * the chapters cited at the end are dropped. Otherwise the detail is the first sentence.
 */
export function described(doc: string | undefined): Pick<Suggestion, 'detail' | 'info'> {
  const text = (doc ?? '').replace(/\s+/g, ' ').trim().replace(/\s*\[\d+(?:\.\d+)*\.\s[^[\]]*\]$/, '');
  if (!text) return {};
  const gloss = text.match(/^\(([^()]+)\)\s*(.*)$/);
  if (gloss) return gloss[2] ? { detail: gloss[1], info: gloss[2] } : { detail: gloss[1] };
  let detail = text.split(/(?<=[.;:])\s/, 1)[0].replace(/[.;:]$/, '');
  if (detail.length > DETAIL_MAX) detail = detail.slice(0, DETAIL_MAX).replace(/\s\S*$/, '') + '…';
  return detail === text ? { detail } : { detail, info: text };
}

/** The names a name pattern stands for, as the document can write them: in a namespace it has a prefix (or the default) for. */
function names(n: BaseName, resolver: DefaultNameResolver, attribute: boolean): { label: string; doc?: string }[] {
  if (n instanceof NameChoice) return [...names(n.a, resolver, attribute), ...names(n.b, resolver, attribute)];
  if (!(n instanceof Name)) return []; // any name, or any in a namespace: nothing to offer by name
  const label = attribute && n.ns === '' ? n.name : resolver.unresolveName(n.ns, n.name);
  return label ? [{ label, doc: n.documentation }] : [];
}

const ATTR = /\s([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/g;

/** Where the cursor is: in a start tag's name, among its attributes, in a value, or between tags. */
function context(before: string) {
  // a '<' in a comment, CDATA section or processing instruction is not a tag
  for (const [open, close] of [['<!--', '-->'], ['<![CDATA[', ']]>'], ['<?', '?>']]) {
    if (before.lastIndexOf(open) > before.lastIndexOf(close)) return null;
  }
  const lt = before.lastIndexOf('<');
  if (lt <= before.lastIndexOf('>')) return { at: 'text' as const, tagStart: before.length };
  const tag = before.slice(lt);
  if (/^<[/!?]/.test(tag)) return null;
  const partialName = tag.match(/^<([^\s/>]*)$/);
  if (partialName) return { at: 'name' as const, tagStart: lt, typed: partialName[1] };
  const name = tag.match(/^<([^\s/>]+)/)?.[1];
  if (!name) return null;
  const done = [...tag.matchAll(ATTR)];
  const tail = tag.slice(done.length ? done[done.length - 1].index! + done[done.length - 1][0].length : name.length + 1);
  const attrs = done.map(m => ({ name: m[1], value: m[2].slice(1, -1) }));
  const inValue = tail.match(/\s([^\s=/>]+)\s*=\s*(["'])([^"']*)$/);
  if (inValue) return { at: 'value' as const, tagStart: lt, name, attrs, attr: inValue[1], typed: inValue[3] };
  const inName = tail.match(/\s([^\s=/>]*)$/);
  if (inName) return { at: 'attribute' as const, tagStart: lt, name, attrs, typed: inName[1] };
  return null;
}

/** What may be written at position `at` of xml. */
export function possibleAt(grammar: Grammar, xml: string, at: number): Possible | null {
  const before = xml.slice(0, at);
  const ctx = context(before);
  if (!ctx) return null;

  const resolver = new DefaultNameResolver();
  const walker = grammar.newWalker(resolver);
  const parser = new SaxesParser({ xmlns: true });
  let text = '';
  const flush = () => { if (text.trim() !== '') walker.fireEvent('text', [text]); text = ''; };
  // the text before the cursor is rarely valid, or even finished: errors are ignored, the walker goes on
  parser.on('error', () => {});
  parser.on('opentag', (node: SaxesTagNS) => {
    flush();
    resolver.enterContext();
    for (const [qn, a] of Object.entries(node.attributes)) {
      if (qn === 'xmlns') resolver.definePrefix('', a.value);
      else if (a.prefix === 'xmlns') resolver.definePrefix(a.local, a.value);
    }
    walker.fireEvent('enterStartTag', [node.uri, node.local]);
    for (const [qn, a] of Object.entries(node.attributes)) {
      if (qn === 'xmlns' || a.prefix === 'xmlns') continue;
      walker.fireEvent('attributeName', [a.uri, a.local]);
      walker.fireEvent('attributeValue', [a.value]);
    }
    walker.fireEvent('leaveStartTag', []);
  });
  parser.on('closetag', (node: SaxesTagNS) => { flush(); walker.fireEvent('endTag', [node.uri, node.local]); resolver.leaveContext(); });
  parser.on('text', s => { text += s; });
  parser.on('cdata', s => { text += s; });
  try { parser.write(xml.slice(0, ctx.tagStart)); } catch { /* ignored, as above */ }
  flush();

  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  const add = (kind: Suggestion['kind'], label: string, doc?: string) => {
    if (seen.has(label)) return;
    seen.add(label);
    suggestions.push({ kind, label, ...described(doc) });
  };

  if (ctx.at === 'text' || ctx.at === 'name') {
    for (const ev of walker.possible()) {
      if (ev.name === 'enterStartTag') for (const n of names(ev.param, resolver, false)) add('element', n.label, n.doc);
    }
    return { from: at - (ctx.at === 'name' ? ctx.typed.length : 0), inTag: ctx.at === 'name', suggestions };
  }

  // inside a start tag: enter it with the attributes already written, then ask
  resolver.enterContext();
  for (const a of ctx.attrs) {
    if (a.name === 'xmlns') resolver.definePrefix('', a.value);
    else if (a.name.startsWith('xmlns:')) resolver.definePrefix(a.name.slice(6), a.value);
  }
  const element = resolver.resolveName(ctx.name);
  if (!element) return null;
  walker.fireEvent('enterStartTag', [element.ns, element.name]);
  const written = new Set<string>();
  for (const a of ctx.attrs) {
    written.add(a.name);
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:') || (ctx.at === 'value' && a.name === ctx.attr)) continue;
    const n = resolver.resolveName(a.name, true);
    if (!n) continue;
    walker.fireEvent('attributeName', [n.ns, n.name]);
    walker.fireEvent('attributeValue', [a.value]);
  }

  if (ctx.at === 'attribute') {
    for (const ev of walker.possible()) {
      if (ev.name !== 'attributeName') continue;
      for (const n of names(ev.param, resolver, true)) if (!written.has(n.label)) add('attribute', n.label, n.doc);
    }
    return { from: at - ctx.typed.length, inTag: true, suggestions };
  }

  const n = resolver.resolveName(ctx.attr, true);
  if (!n) return null;
  walker.fireEvent('attributeName', [n.ns, n.name]);
  for (const ev of walker.possible()) {
    if (ev.name === 'attributeValue' && typeof ev.param === 'string') add('value', ev.param, ev.documentation);
  }
  return { from: at - ctx.typed.length, inTag: true, suggestions };
}
