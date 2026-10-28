import { loadPyodide } from 'pyodide';
import fs from 'node:fs';
const py = await loadPyodide();
await py.loadPackage(['micropip','lxml','jinja2','pygments','platformdirs']);
const w='open_processing_model-0.9.0-py3-none-any.whl';
py.FS.writeFile('/tmp/'+w, fs.readFileSync('dist/'+w));
await py.runPythonAsync(`
import micropip
await micropip.install(['elementpath>=4.8','python-docx>=1.1'])
await micropip.install('emfs:/tmp/${w}', deps=False)
from opm import Project
from lxml import etree
p=Project()
t=etree.fromstring(open('/dev/null').read().encode() or b'<x/>').getroottree()
`);
py.FS.writeFile('/tmp/doc.xml', fs.readFileSync('sample.xml'));
for (const m of ['web','markdown','json','docx','typst','epub']) {
  try { console.log(m, await py.runPythonAsync(`r=p.transform(etree.parse('/tmp/doc.xml'), mode='${m}'); f"{type(r).__name__} {len(r)}"`)); }
  catch (e) { console.log(m, 'FAIL', String(e).split('\n').slice(-2).join(' ')); }
}

// chunked output through glue.py, as the chunk mode calls it
py.FS.mkdirTree('/studio');
py.FS.writeFile('/studio/completion_schema.py', fs.readFileSync('src/runtime/completion_schema.py'));
py.runPython(`import sys; sys.path.insert(0, '/studio')`);
py.runPython(fs.readFileSync('src/runtime/glue.py', 'utf8'));
for (const ex of ['jats', 'shakespeare']) {
  const sample = py.globals.get('copy_example')('/proj-' + ex, ex, true);
  const run = JSON.parse(py.globals.get('chunk')('/proj-' + ex, sample, '/tmp/chunks-' + ex));
  const pages = run.files.filter(f => f.endsWith('.html'));
  if (run.landing !== 'index.html' || pages.length < 2 || !run.files.includes(run.landing)) {
    console.log('chunk', ex, 'FAIL', JSON.stringify(run).slice(0, 300)); process.exitCode = 1;
  } else console.log('chunk', ex, `${pages.length} pages, ${run.files.length} files`);
}

// a web page with the assets its template links ([transform.web] assets), as the rendered preview serves it
{
  const sample = py.globals.get('copy_example')('/proj-serafin', 'serafin', true);
  const html = py.globals.get('convert')('/proj-serafin', sample, 'web');
  const site = JSON.parse(py.globals.get('page_site')('/proj-serafin', 'web', 'page.html', html, '/tmp/page-serafin'));
  const want = ['assets/letter.css', 'assets/parchment.jpg', 'page.html'];
  if (want.some(f => !site.files.includes(f)) || site.landing !== 'page.html' || !html.includes('assets/letter.css')) {
    console.log('page assets FAIL', JSON.stringify(site)); process.exitCode = 1;
  } else console.log('page assets', site.files.join(', '));
}

// ODD documentation through glue.py, as the ODD editor's Document button calls it
for (const [ex, odd] of [['jats', 'odd/jats.odd'], ['shakespeare', null]]) {
  const dir = '/proj-' + ex;
  const target = odd ?? py.runPython(`next(str(p.relative_to('${dir}')) for p in __import__('pathlib').Path('${dir}').rglob('*.odd'))`);
  const t = performance.now();
  let run = JSON.parse(py.globals.get('document_odd')(dir, target, '/tmp/doc-' + ex));
  if (run.needTei) {
    py.globals.get('install_tei')(new Uint8Array(fs.readFileSync('dist/p5all.xml.gz')));
    run = JSON.parse(py.globals.get('document_odd')(dir, target, '/tmp/doc-' + ex));
  }
  const pages = (run.files ?? []).filter(f => f.endsWith('.html'));
  if (!run.landing || pages.length < 2) { console.log('odd document', target, 'FAIL', JSON.stringify(run).slice(0, 300)); process.exitCode = 1; }
  else console.log('odd document', target, `${pages.length} pages, landing ${run.landing}, ${Math.round(performance.now() - t)} ms`);
}

// autocompletion from a project's RELAX NG schema, as the source editor asks for it
{
  const rng = (body) => `<grammar xmlns="http://relaxng.org/ns/structure/1.0">${body}</grammar>`;
  py.FS.mkdirTree('/proj-rng/schema');
  py.FS.writeFile('/proj-rng/schema/main.rng', rng(`<start><element name="doc"><zeroOrMore><ref name="block"/></zeroOrMore></element></start><include href="blocks.rng"/>`));
  py.FS.writeFile('/proj-rng/schema/blocks.rng', rng(`<define name="block"><element name="para"><attribute name="role"><choice><value>note</value><value>tip</value></choice></attribute><text/></element></define>`));
  const s = JSON.parse(py.globals.get('completion_from_rng')('/proj-rng', 'schema/main.rng'));
  const doc = s.elements.find(e => e.name === 'doc'), para = s.elements.find(e => e.name === 'para');
  const role = [...(para?.attributes ?? []), ...s.attributes].find(a => a.name === 'role' || a === 'role');
  const values = (typeof role === 'string' ? s.attributes.find(a => a.name === role) : role)?.values;
  if (!doc?.top || doc.children.join() !== 'para' || values?.join() !== 'note,tip') {
    console.log('rng completion FAIL', JSON.stringify(s).slice(0, 300)); process.exitCode = 1;
  } else console.log('rng completion', s.elements.map(e => e.name).join(', '));
}
