import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { xml } from '@codemirror/lang-xml';
import { teiElements } from '../../src/ui/teiSchema.ts';

const elements = teiElements(JSON.parse(readFileSync(new URL('../../schema/tei.json', import.meta.url), 'utf8')));

test('only TEI and teiCorpus are offered at the root', () => {
  assert.deepEqual(elements.filter(e => e.top).map(e => e.name).sort(), ['TEI', 'teiCorpus']);
});

test('descriptions carry no null details', () => {
  for (const e of elements) {
    assert.notEqual(e.completion?.detail, null, e.name);
    for (const a of e.attributes ?? []) if (typeof a !== 'string') assert.notEqual(a.completion?.detail, null, e.name + '/@' + a.name);
  }
});

test('attributes are inserted with their quotes', () => {
  const p = elements.find(e => e.name === 'p')!;
  assert.ok(p.children?.includes('hi'));
  const n = p.attributes?.find(a => typeof a !== 'string' && a.name === 'n');
  assert.ok(n && typeof n !== 'string' && typeof n.completion?.apply === 'function');
});

/** What the editor would offer with the cursor at `|`. */
function complete(text: string): string[] {
  const pos = text.indexOf('|'), doc = text.replace('|', '');
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [xml({ elements })] });
  const [source] = state.languageDataAt<(cx: CompletionContext) => CompletionResult | null>('autocomplete', pos);
  return source(new CompletionContext(state, pos, true))?.options.map(o => o.label) ?? [];
}

test('completion offers what TEI allows where the cursor is', () => {
  assert.deepEqual(complete('|').sort(), ['<TEI', '<teiCorpus']);
  const inP = complete('<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p>|</p></body></text></TEI>');
  assert.ok(inP.includes('<hi') && inP.includes('<persName') && !inP.includes('<teiHeader'));
  assert.ok(complete('<TEI><text><body><p |></p></body></text></TEI>').includes('rend'));
});
