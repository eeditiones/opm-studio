import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addSpec, deleteSpec, inheritable, pasteSpec, updateSpec } from '../../src/odd/edit.ts';
import { parseOdd } from '../../src/odd/oddModel.ts';

const ODD = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <text>
    <body>
      <schemaSpec ident="custom" start="TEI" source="teipublisher.odd">
        <!-- keep this comment -->
        <elementSpec ident="head" mode="change">
          <model   predicate="parent::div" behaviour="heading">
            <param name="level" value="1"/>
          </model>
          <model behaviour="block"/>
        </elementSpec>
        <elementSpec ident="p" mode="change">
          <model behaviour="paragraph"/>
        </elementSpec>
      </schemaSpec>
    </body>
  </text>
</TEI>
`;

const PARENT = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>
    <schemaSpec ident="teipublisher">
        <elementSpec ident="hi" mode="add">
            <model behaviour="inline"/>
        </elementSpec>
        <elementSpec ident="p" mode="add">
            <model behaviour="paragraph"/>
        </elementSpec>
    </schemaSpec>
</body></text></TEI>`;

test('an unchanged spec is written back byte for byte', () => {
  const spec = parseOdd(ODD).elementSpecs[0];
  assert.equal(updateSpec(ODD, 0, spec), ODD);
});

test('changing one model rewrites only that model', () => {
  const spec = parseOdd(ODD).elementSpecs[0];
  spec.models[1].behaviour = 'inline';
  const out = updateSpec(ODD, 0, spec);
  assert.match(out, /<model behaviour="inline"\/>/);
  // the untouched first model keeps its odd spacing, and the comment survives
  assert.match(out, /<model {3}predicate="parent::div"/);
  assert.match(out, /<!-- keep this comment -->/);
  assert.equal(out.split('\n').length, ODD.split('\n').length);
});

test('deleteSpec removes the spec and its line', () => {
  const out = deleteSpec(ODD, 1);
  assert.deepEqual(parseOdd(out).elementSpecs.map(s => s.ident), ['head']);
  assert.doesNotMatch(out, /^\s*\n\s*<\/schemaSpec>/m);
});

test('addSpec copies an inherited spec with mode="change"', () => {
  const res = addSpec(ODD, 'hi', PARENT);
  assert.ok('text' in res);
  const spec = parseOdd(res.text).elementSpecs.find(s => s.ident === 'hi');
  assert.equal(spec?.mode, 'change');
  assert.equal(spec?.models[0].behaviour, 'inline');
  // only the spec's own indent is adjusted; inner lines keep the parent's steps
  assert.match(res.text, /\n {8}<elementSpec ident="hi" mode="change">\n {12}<model behaviour="inline"\/>\n {8}<\/elementSpec>\n {6}<\/schemaSpec>/);
});

test('addSpec scaffolds unknown idents and refuses duplicates', () => {
  const res = addSpec(ODD, 'foo');
  assert.ok('text' in res);
  assert.equal(parseOdd(res.text).elementSpecs.at(-1)?.ident, 'foo');
  assert.deepEqual(addSpec(ODD, 'head'), { error: 'An elementSpec with ident "head" already exists.' });
});

test('pasteSpec renames a copy whose ident is taken', () => {
  const res = pasteSpec(ODD, parseOdd(ODD).elementSpecs[1]);
  assert.ok('text' in res);
  assert.equal(res.ident, 'p_copy');
});

test('inheritable lists parent idents not yet overridden', () => {
  assert.deepEqual(inheritable(ODD, PARENT), ['hi']);
});

// Specs that share lines with other markup, as in ODDs written without line breaks
const PACKED = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><schemaSpec ident="x" source="teipublisher.odd"><elementSpec ident="head" mode="change">
    <model behaviour="heading"/>
</elementSpec><elementSpec ident="emph" mode="add">
    <model behaviour="inline"/>
</elementSpec></schemaSpec></body></text></TEI>`;

test('addSpec puts the spec after the last one, not inside it, when </schemaSpec> shares a line', () => {
  const res = addSpec(PACKED, 'hi', PARENT);
  assert.ok('text' in res);
  const specs = parseOdd(res.text).elementSpecs;
  assert.deepEqual(specs.map(s => s.ident), ['head', 'emph', 'hi']);
  assert.match(res.text, /<\/elementSpec>\n<elementSpec ident="hi" mode="change">[\s\S]*<\/elementSpec>\n<\/schemaSpec>/);
});

test('deleteSpec keeps markup that shares the spec\'s line', () => {
  const out = deleteSpec(PACKED, 1);
  assert.deepEqual(parseOdd(out).elementSpecs.map(s => s.ident), ['head']);
  assert.match(out, /<model behaviour="heading"\/>\n<\/elementSpec><\/schemaSpec>/);
});

test('updateSpec on a spec that starts mid-line leaves the preceding markup alone', () => {
  const spec = parseOdd(PACKED).elementSpecs[1];
  assert.equal(updateSpec(PACKED, 1, spec), PACKED);
  spec.models.push({ type: 'model', behaviour: 'block', params: [], renditions: [], models: [] });
  const out = updateSpec(PACKED, 1, spec);
  assert.deepEqual(parseOdd(out).elementSpecs[1].models.map(m => m.behaviour), ['inline', 'block']);
  assert.doesNotMatch(out.slice(out.indexOf('ident="emph"')), /<\/elementSpec>\s*<model/);
});

const WRAPPED = `<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body>
  <schemaSpec ident="custom">
    <elementSpec ident="p" mode="change">
      <desc>A paragraph,
        spread over <gi>two</gi> lines.</desc>
      <model behaviour="paragraph">
        <desc>Rule
          description</desc>
      </model>
    </elementSpec>
  </schemaSpec>
</body></text></TEI>`;

test('a desc spread over lines reads as one line and is kept as is until edited', () => {
  const spec = parseOdd(WRAPPED).elementSpecs[0];
  assert.equal(spec.desc, 'A paragraph, spread over <gi>two</gi> lines.');
  assert.equal(spec.models[0].desc, 'Rule description');
  assert.equal(updateSpec(WRAPPED, 0, spec), WRAPPED);
  spec.desc = 'Changed';
  assert.match(updateSpec(WRAPPED, 0, spec), /<desc>Changed<\/desc>\n {6}<model/);
});
