import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { xml } from '@codemirror/lang-xml';
import { completionSchema, type RawSchema, type XmlSchema } from '../../src/ui/completionSchema.ts';

const tei = completionSchema(JSON.parse(readFileSync(new URL('../../schema/tei.json', import.meta.url), 'utf8')));

/** completion_schema.py on tests/python/fixtures/rng/main.rng. */
const fromRng: RawSchema = {
  elements: [
    { name: 'doc', top: true, children: ['list', 'para', 'section', 'title'], attributes: [], completion: { detail: 'document', info: 'the root of a test document.' } },
    { name: 'em', children: [], attributes: [] },
    { name: 'item', children: [], attributes: [] },
    { name: 'list', children: ['item'], attributes: [] },
    { name: 'para', children: ['em'], attributes: [] },
    { name: 'section', children: ['list', 'para', 'section', 'title'], attributes: [{ name: 'id' }, 'type', 'xlink:href'], completion: { detail: 'A section', info: 'A section. It may hold further sections.' } },
    { name: 'title', children: [], attributes: [{ name: 'id', completion: { detail: 'identifies the title' } }, 'level'] },
  ],
  attributes: [
    { name: 'level' },
    { name: 'type', values: [{ label: 'chapter', detail: 'a chapter' }, 'appendix'], completion: { detail: 'the kind of section' } },
    { name: 'xlink:href' },
  ],
};

/** What the editor would offer with the cursor at `|`. */
function complete(schema: XmlSchema, text: string): string[] {
  const pos = text.indexOf('|'), doc = text.replace('|', '');
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [xml(schema)] });
  const [source] = state.languageDataAt<(cx: CompletionContext) => CompletionResult | null>('autocomplete', pos);
  return source(new CompletionContext(state, pos, true))?.options.map(o => o.label) ?? [];
}

test('tei.json: only TEI and teiCorpus are offered at the root', () => {
  assert.deepEqual(tei.elements.filter(e => e.top).map(e => e.name).sort(), ['TEI', 'teiCorpus']);
  assert.deepEqual(complete(tei, '|').sort(), ['<TEI', '<teiCorpus']);
});

test('tei.json: descriptions carry no null details', () => {
  for (const e of tei.elements) {
    assert.notEqual(e.completion?.detail, null, e.name);
    for (const a of e.attributes ?? []) if (typeof a !== 'string') assert.notEqual(a.completion?.detail, null, e.name + '/@' + a.name);
  }
});

test('tei.json: completion offers what TEI allows where the cursor is', () => {
  const inP = complete(tei, '<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><p>|</p></body></text></TEI>');
  assert.ok(inP.includes('<hi') && inP.includes('<persName') && !inP.includes('<teiHeader'));
  assert.ok(complete(tei, '<TEI><text><body><p |></p></body></text></TEI>').includes('rend'));
});

test('opm JSON: elements follow the schema and its start', () => {
  const s = completionSchema(fromRng);
  assert.deepEqual(complete(s, '|'), ['<doc']);
  assert.deepEqual(complete(s, '<doc><para>|</para></doc>').filter(l => l.startsWith('<') && !l.startsWith('</')), ['<em']);
});

test('opm JSON: attributes named by a string come from the shared list, with their values', () => {
  const s = completionSchema(fromRng);
  assert.deepEqual(complete(s, '<doc><section |></section></doc>').sort(), ['id', 'type', 'xlink:href']);
  assert.deepEqual(complete(s, '<doc><section type=|></section></doc>'), ['"chapter"', '"appendix"']);
  const type = s.attributes.find(a => a.name === 'type')!;
  assert.equal(typeof type.completion?.apply, 'function');
  assert.equal(type.completion?.detail, 'the kind of section');
});
