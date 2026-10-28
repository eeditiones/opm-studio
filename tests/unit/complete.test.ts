import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertRNGToPattern } from 'salve-annos';
import { described, possibleAt } from '../../src/runtime/complete.ts';

const tei = (await convertRNGToPattern(new URL('../../schema/tei/tei_all.rng', import.meta.url))).pattern;
const TEI = '<TEI xmlns="http://www.tei-c.org/ns/1.0">';
/** A valid start up to <body>: after an element it cannot place, the walker has nothing to offer. */
const BODY = `${TEI}<teiHeader><fileDesc><titleStmt><title>t</title></titleStmt><publicationStmt><p>x</p></publicationStmt>` +
  '<sourceDesc><p>x</p></sourceDesc></fileDesc></teiHeader><text><body>';

/** What is offered with the cursor at `|`, and from where it would replace. */
function at(text: string) {
  const pos = text.indexOf('|'), xml = text.replace('|', '');
  const r = possibleAt(tei, xml, pos);
  return r && { from: r.from - pos, inTag: r.inTag, labels: r.suggestions.map(s => s.label) };
}

test('elements follow the content model in order', () => {
  assert.deepEqual(at(`${TEI}<|`)?.labels, ['teiHeader']);
  assert.deepEqual(at(`${TEI}<teiHeader><fileDesc><titleStmt><title>t</title></titleStmt><|`)?.labels, ['editionStmt', 'extent', 'publicationStmt']);
});

test('a partly typed name is replaced from just after the <', () => {
  const r = at(`${TEI}<teiH|`);
  assert.deepEqual(r && { from: r.from, inTag: r.inTag }, { from: -4, inTag: true });
});

test('between tags, elements are offered as a whole', () => {
  const r = at(`${BODY}<p>a |`);
  assert.equal(r?.inTag, false);
  assert.ok(r?.labels.includes('hi') && r.labels.includes('persName') && !r.labels.includes('teiHeader'));
});

test('attributes not yet written, then the values of one', () => {
  const attrs = at(`${BODY}<p><hi rend="x" |`)?.labels ?? [];
  assert.ok(attrs.includes('cert') && attrs.includes('xml:id') && !attrs.includes('rend'));
  assert.deepEqual(at(`${BODY}<p><hi cert="h|`), { from: -1, inTag: true, labels: ['high', 'medium', 'low', 'unknown'] });
});

test('an error already closed does not stop the suggestions after it', () => {
  assert.ok(at(`${BODY}<bogus><x/></bogus><p><hi cert="maybe">x</hi> <hi |`)?.labels.includes('rend'));
});

test('nothing is offered in end tags, comments or processing instructions', () => {
  assert.equal(at(`${TEI}<text></te|`), null);
  assert.equal(at(`${TEI}<!-- <|`), null);
  assert.equal(at(`${TEI}<?pi <|`), null);
});

test('TEI documentation: the gloss is the detail, the chapters cited are dropped', () => {
  assert.deepEqual(described('(paragraph) marks paragraphs in prose. [3.1. Paragraphs 7.2.6. Speech Contents]'), { detail: 'paragraph', info: 'marks paragraphs in prose.' });
  assert.deepEqual(described('A section. It may hold further sections.'), { detail: 'A section', info: 'A section. It may hold further sections.' });
  assert.deepEqual(described(undefined), {});
});
