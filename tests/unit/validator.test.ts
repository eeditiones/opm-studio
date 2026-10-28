import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { convertRNGToPattern, type Resource } from 'salve-annos';
import { validate, type Problem } from '../../src/runtime/validate.ts';

const tei = (await convertRNGToPattern(new URL('../../schema/tei/tei_all.rng', import.meta.url))).pattern;
const sample = readFileSync(new URL('../../sample.xml', import.meta.url), 'utf8');

/** What each problem marks, with its message. */
const marked = (xml: string, problems: Problem[]) => problems.map(p => [xml.slice(p.from, p.to), p.message]);

const doc = (header: string, body: string) =>
  `<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>${header}` +
  '<publicationStmt><p>x</p></publicationStmt><sourceDesc><p>x</p></sourceDesc></fileDesc></teiHeader>' +
  `<text><body>${body}</body></text></TEI>`;
const TITLE = '<titleStmt><title>t</title></titleStmt>';

test('sample.xml is valid TEI', () => {
  assert.deepEqual(validate(tei, sample), []);
});

test('an element out of place is marked by its name', () => {
  const xml = doc(TITLE, '<p><hi><div/></hi></p>');
  assert.deepEqual(marked(xml, validate(tei, xml)), [['div', '<div> is not allowed here']]);
});

test('an invalid attribute value names the value and marks the attribute', () => {
  const xml = doc(TITLE, '<p><date when="April 1st">x</date> <hi cert="maybe">y</hi></p>');
  assert.deepEqual(marked(xml, validate(tei, xml)), [
    ['when', '"April 1st" is not a valid value for @when'],
    ['cert', '"maybe" is not a valid value for @cert'],
  ]);
});

test('a missing child is reported at the end tag of its parent', () => {
  const xml = doc('<titleStmt></titleStmt>', '<p/>');
  assert.deepEqual(marked(xml, validate(tei, xml)), [['titleStmt', '<title> is required here']]);
});

test('a syntax error is reported once, and nothing after it', () => {
  const xml = doc(TITLE, '<p>a<hi>b</p><bogus/>');
  const problems = validate(tei, xml);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /close tag/);
  assert.ok(problems[0].from > xml.indexOf('</p>') - 1 && problems[0].to <= xml.length);
});

test('a project schema split over files is read through the loader', async () => {
  const files: Record<string, string> = {
    'schema/main.rng': '<grammar xmlns="http://relaxng.org/ns/structure/1.0"><include href="parts.rng"/></grammar>',
    'schema/parts.rng': '<grammar xmlns="http://relaxng.org/ns/structure/1.0"><start><element name="doc">' +
      '<attribute name="type"><choice><value>a</value><value>b</value></choice></attribute>' +
      '<oneOrMore><element name="item"><text/></element></oneOrMore></element></start></grammar>',
  };
  const base = 'file:///project/';
  const resourceLoader = { async load(url: URL): Promise<Resource> { return { url, getText: async () => files[url.href.slice(base.length)] }; } };
  const { pattern } = await convertRNGToPattern(new URL('schema/main.rng', base), { resourceLoader } as Parameters<typeof convertRNGToPattern>[1]);
  assert.deepEqual(validate(pattern, '<doc type="a"><item>x</item></doc>'), []);
  const xml = '<doc type="c"><other/></doc>';
  assert.deepEqual(marked(xml, validate(pattern, xml)), [
    ['type', '"c" is not a valid value for @type'],
    ['other', '<other> is not allowed here'],
    ['doc', '<item> is required here'],
  ]);
});
