import assert from 'node:assert/strict';
import { test } from 'node:test';
import { excerpt, reportError } from '../../src/runtime/errorReport.ts';

const DIR = '/projects/monograph';
const XML_ERROR = `PythonError: Traceback (most recent call last):
  File "/lib/python3.12/site-packages/opm/parse.py", line 40, in load
    tree = etree.parse(path)
           ^^^^^^^^^^^^^^^^^
  File "src/lxml/parser.pxi", line 689, in lxml.etree._raiseParseError
  File "/projects/monograph/data/47009.xml", line 13
lxml.etree.XMLSyntaxError: Specification mandates value for attribute Karl, line 13, column 31
`;

test('reportError reads an XML syntax error and where it is', () => {
  const r = reportError(XML_ERROR, DIR);
  assert.equal(r.title, 'The XML is not well-formed');
  assert.equal(r.message, 'Specification mandates value for attribute Karl');
  assert.equal(r.file, 'data/47009.xml');
  assert.equal(r.line, 13);
  assert.equal(r.column, 31);
  assert.match(r.trace, /^Traceback/);
});

test('reportError takes the innermost project frame, without a column from another line', () => {
  const r = reportError(`Traceback (most recent call last):
  File "/projects/monograph/extensions/fn.py", line 3, in f
  File "/projects/monograph/templates/a.html.j2", line 7, in top-level template code
jinja2.exceptions.UndefinedError: 'x' is undefined, line 99, column 2
`, DIR);
  assert.equal(r.title, 'The template uses something undefined');
  assert.equal(r.file, 'templates/a.html.j2');
  assert.equal(r.line, 7);
  assert.equal(r.column, undefined);
});

test('reportError keeps a message of several lines and falls back for unknown types', () => {
  const r = reportError(`Traceback (most recent call last):
  File "/lib/opm/x.py", line 1, in f
    raise ValueError(m)
ValueError: first line
second line in /projects/monograph/opm.toml
`, DIR, 'The transformation failed');
  assert.equal(r.title, 'The transformation failed');
  assert.equal(r.message, 'first line\nsecond line in opm.toml');
  assert.equal(r.file, undefined);
});

test('reportError leaves text without a traceback as a plain message', () => {
  const r = reportError('Error: no route to host', DIR, 'Could not load');
  assert.deepEqual(r, { title: 'Could not load', message: 'no route to host', trace: '' });
});

test('excerpt shows the lines around the error and marks its line', () => {
  assert.deepEqual(excerpt('a\nb\nc\nd\ne\nf', 3), [
    { n: 1, text: 'a', hit: false }, { n: 2, text: 'b', hit: false }, { n: 3, text: 'c', hit: true },
    { n: 4, text: 'd', hit: false }, { n: 5, text: 'e', hit: false },
  ]);
  assert.deepEqual(excerpt('a', 5), []);
});

test('excerpt cuts a long line down to the part around the column', () => {
  const [line] = excerpt('x'.repeat(1000) + 'ERR' + 'y'.repeat(1000), 1, 1001);
  assert.ok(line.text.startsWith('…') && line.text.endsWith('…') && line.text.includes('ERR'));
  assert.ok(line.text.length <= 162);
});
