import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertRNGToPattern } from 'salve-annos';
import { possibleAt } from '../../src/runtime/complete.ts';
import { validate } from '../../src/runtime/validate.ts';

/** TEI Publisher's ODD for ODD authoring, as npm run schemas compiles it. */
const odds = (await convertRNGToPattern(new URL('../../schema/odd/teipublisher_odds.rng', import.meta.url))).pattern;

const odd = (models: string) =>
  '<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:pb="http://teipublisher.com/1.0"><teiHeader><fileDesc>' +
  '<titleStmt><title>t</title></titleStmt><publicationStmt><p>x</p></publicationStmt><sourceDesc><p>x</p></sourceDesc>' +
  '</fileDesc></teiHeader><text><body><schemaSpec ident="t" start="TEI"><elementSpec ident="hi" mode="change">' +
  `${models}</elementSpec></schemaSpec></body></text></TEI>`;

test('templates may hold TEI, HTML and text; behaviours their params', () => {
  const xml = odd(
    '<model behaviour="inline"><param name="x" value="1"/><pb:template xml:space="preserve"><persName ref="[[x]]">[[content]]</persName></pb:template></model>' +
    '<model behaviour="inline" pb:mode="toc"><pb:template xmlns=""><a class="chip" href="[[uri]]"><b>[[label]]</b></a></pb:template></model>');
  assert.deepEqual(validate(odds, xml), []);
});

test('outside a template, the TEI rules still hold', () => {
  const xml = odd('<model behaviour="inline"/><desc>too late</desc>');
  assert.deepEqual(validate(odds, xml).map(p => p.message), ['<desc> is not allowed here']);
});

test('completion offers pb:template in a model', () => {
  const xml = odd('<model behaviour="inline"><');
  const at = xml.indexOf('<model behaviour="inline"><') + '<model behaviour="inline"><'.length;
  assert.ok(possibleAt(odds, xml, at)?.suggestions.some(s => s.label === 'pb:template'));
});
