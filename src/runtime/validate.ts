// ── RELAX NG validation of one XML text with salve, errors as text ranges ──
// Pure, so tests run it without a worker; runtime/validator.ts is the worker around it.
import {
  AnyName, AttributeNameError, AttributeValueError, ChoiceError, DefaultNameResolver, Name, NameChoice, NsName,
  type BaseName, type Grammar, type ValidationError,
} from 'salve-annos';
import { SaxesParser, type SaxesTagNS } from 'saxes';

export interface Problem { from: number; to: number; message: string }

/** More would only slow the editor down; the first ones are what needs fixing. */
const MAX = 200;

/** A name as the document would write it: prefixed where it declares one for the namespace. */
function nameText(n: BaseName, resolver: DefaultNameResolver, attribute: boolean): string {
  if (n instanceof Name) {
    if (!n.ns || (attribute && n.ns === '')) return n.name;
    const q = resolver.unresolveName(n.ns, n.name);
    return q ?? `${n.name} (${n.ns})`;
  }
  if (n instanceof NameChoice) return `${nameText(n.a, resolver, attribute)} or ${nameText(n.b, resolver, attribute)}`;
  if (n instanceof NsName) return `any name in ${n.ns}`;
  if (n instanceof AnyName) return 'any name';
  return String(n);
}

/** salve's messages, worded as the editor shows them; `value` is the attribute value just checked. */
function messageOf(e: ValidationError, resolver: DefaultNameResolver, value?: string): string {
  const attribute = e instanceof AttributeNameError || e instanceof AttributeValueError;
  const names = e.getNames().map(n => nameText(n, resolver, attribute));
  const one = names.join(', ');
  switch (e.msg) {
    case 'tag not allowed here': return `<${one}> is not allowed here`;
    case 'tag required': return `<${one}> is required here`;
    case 'unexpected end tag': return `</${one}> was not expected here`;
    case 'attribute not allowed here': return `@${one} is not allowed here`;
    case 'attribute missing': return `Required attribute @${one} is missing`;
    case 'invalid attribute value': return value === undefined ? `Invalid value for @${one}` : `"${value}" is not a valid value for @${one}`;
    case 'text not allowed here': return 'Text is not allowed here';
  }
  if (e instanceof ChoiceError) return `Expected one of: ${names.map(n => `<${n}>`).join(', ')}`;
  const text = e.toStringWithNames(names);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Validate xml against grammar: well-formedness first, then the schema, stopping at the first syntax error. */
export function validate(grammar: Grammar, xml: string): Problem[] {
  const resolver = new DefaultNameResolver();
  const walker = grammar.newWalker(resolver);
  const parser = new SaxesParser({ xmlns: true, position: true });
  const problems: Problem[] = [];
  let broken = false;

  // where the parser last was: tags are located from there, backwards to their '<'
  let tagFrom = 0, tagTo = 0, textFrom = 0;
  let text = '';
  const report = (r: ReturnType<typeof walker.fireEvent>, from: number, to: number, value?: string) => {
    if (!r) return;
    for (const e of r) if (problems.length < MAX) problems.push({ from, to, message: messageOf(e, resolver, value) });
  };
  const flush = () => {
    if (text === '') return;
    // whitespace between elements is never an error worth showing
    if (text.trim() !== '') report(walker.fireEvent('text', [text]), textFrom, tagFrom);
    text = '';
  };
  /** The span of a tag's name, given where its '<' is. */
  const nameSpan = (from: number, name: string, closing: boolean) => {
    const start = from + (closing ? 2 : 1);
    return [start, start + name.length] as const;
  };

  parser.on('opentag', (node: SaxesTagNS) => {
    if (broken) return;
    tagTo = parser.position;
    tagFrom = xml.lastIndexOf('<', tagTo - 1);
    flush();
    resolver.enterContext();
    for (const [qn, a] of Object.entries(node.attributes)) {
      if (qn === 'xmlns') resolver.definePrefix('', a.value);
      else if (a.prefix === 'xmlns') resolver.definePrefix(a.local, a.value);
    }
    const [nf, nt] = nameSpan(tagFrom, node.name, false);
    report(walker.fireEvent('enterStartTag', [node.uri, node.local]), nf, nt);
    const tag = xml.slice(tagFrom, tagTo);
    for (const [qn, a] of Object.entries(node.attributes)) {
      if (qn === 'xmlns' || a.prefix === 'xmlns') continue;
      const at = tag.search(new RegExp(`\\s${qn.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*=`));
      const af = at < 0 ? nf : tagFrom + at + 1, aend = at < 0 ? nt : af + qn.length;
      report(walker.fireEvent('attributeName', [a.uri, a.local]), af, aend);
      report(walker.fireEvent('attributeValue', [a.value]), af, aend, a.value);
    }
    report(walker.fireEvent('leaveStartTag', []), nf, nt);
    if (node.isSelfClosing) return;
    textFrom = tagTo;
  });
  parser.on('closetag', (node: SaxesTagNS) => {
    if (broken) return;
    if (node.isSelfClosing) {
      // the start tag was the whole element
      report(walker.fireEvent('endTag', [node.uri, node.local]), ...nameSpan(tagFrom, node.name, false));
    } else {
      tagTo = parser.position;
      tagFrom = xml.lastIndexOf('</', tagTo - 1);
      flush();
      report(walker.fireEvent('endTag', [node.uri, node.local]), ...nameSpan(tagFrom, node.name, true));
    }
    resolver.leaveContext();
    textFrom = tagTo;
  });
  parser.on('text', s => { text += s; });
  parser.on('cdata', s => { text += s; });
  parser.on('error', e => {
    if (broken) return;
    broken = true;
    const at = Math.min(parser.position, xml.length);
    problems.push({ from: Math.max(0, at - 1), to: at, message: e.message.replace(/^(?:[^:\n]*:)?\d+:\d+: /, '') });
  });

  // saxes keeps going after an error, but the walker would only report the fallout:
  // the handlers above stop, and what came before the error stays reported
  try { parser.write(xml).close(); } catch { /* reported through 'error' */ }
  if (broken) return problems;

  const end = walker.end();
  report(end, tagFrom, tagTo);
  return problems;
}
