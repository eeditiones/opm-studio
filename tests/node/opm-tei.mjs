import { loadPyodide } from 'pyodide';
import fs from 'node:fs';
const py = await loadPyodide();
await py.loadPackage(['micropip', 'lxml', 'jinja2', 'pygments', 'platformdirs']);
const wheel = fs.readFileSync('dist/open_processing_model-0.10.0-py3-none-any.whl');
py.FS.writeFile('/tmp/open_processing_model-0.10.0-py3-none-any.whl', wheel);
await py.runPythonAsync(`
import micropip
await micropip.install(['elementpath>=4.8', 'python-docx>=1.1'])
await micropip.install('emfs:/tmp/open_processing_model-0.10.0-py3-none-any.whl', deps=False)
`);
py.FS.writeFile('/tmp/doc.xml', fs.readFileSync(`${process.env.OPM_DIR ?? '../tei-publisher-py'}/examples/tei-test.xml`));
const out = await py.runPythonAsync(`
import time
t=time.time()
from opm import Project
p = Project()
html = p.transform('/tmp/doc.xml')
print('secs', time.time()-t)
html[:300] if isinstance(html,str) else repr(html[:100])
`);
console.log(out);
