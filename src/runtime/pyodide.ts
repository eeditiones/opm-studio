// ── Python runtime: Pyodide from the CDN, opm from the wheel beside the page ─
import type { PyodideAPI } from 'pyodide';
import { PYODIDE, WHEEL } from '../config.ts';
import { withDownloadProgress, type DownloadProgress } from './download.ts';
import completionSchema from './completion_schema.py';
import glue from './glue.py';

/** Step label, rough percent, and optional byte counts while CDN files arrive. */
export type RuntimeProgress = (step: string, pct: number, download?: DownloadProgress) => void;

/** The loaded runtime. Set once by loadRuntime; everything else imports it. */
export let py: PyodideAPI;

export async function loadRuntime(progress: RuntimeProgress): Promise<PyodideAPI> {
  py = await createRuntime(progress);
  return py;
}

/** A fresh Pyodide with opm, glue.py and the modules it imports; the page has one, the documentation worker another. */
export async function createRuntime(progress: RuntimeProgress = () => {}): Promise<PyodideAPI> {
  let step = 'Loading Python…';
  let stepPct = 5;
  let download: DownloadProgress | undefined;

  const report = () => {
    const pct = download && download.total > 0
      ? Math.min(80, Math.round((download.loaded / download.total) * 80))
      : stepPct;
    progress(step, pct, download);
  };

  return withDownloadProgress((loaded, total) => {
    download = loaded > 0 ? { loaded, total } : undefined;
    report();
  }, async () => {
    step = 'Loading Python…';
    stepPct = 5;
    report();
    const { loadPyodide } = await import(PYODIDE + 'pyodide.mjs') as typeof import('pyodide');
    const runtime = await loadPyodide({ indexURL: PYODIDE });
    step = 'Loading packages…';
    stepPct = 45;
    report();
    await runtime.loadPackage(['micropip', 'lxml', 'jinja2', 'pygments', 'platformdirs']);
    // relative to this script's bundle in dist/, so it resolves the same from the page and the worker
    runtime.FS.writeFile('/tmp/' + WHEEL, new Uint8Array(await (await fetch(new URL(WHEEL, import.meta.url))).arrayBuffer()));
    step = 'Installing opm…';
    stepPct = 85;
    report();
    await runtime.runPythonAsync(`
import micropip
await micropip.install(['elementpath>=4.8', 'python-docx>=1.1'])
await micropip.install('emfs:/tmp/${WHEEL}', deps=False)
`);
    // studio's own Python modules, importable from glue.py
    runtime.FS.mkdirTree('/studio');
    runtime.FS.writeFile('/studio/completion_schema.py', completionSchema);
    await runtime.runPythonAsync(`import sys; sys.path.insert(0, '/studio')`);
    await runtime.runPythonAsync(glue);
    stepPct = 90;
    report();
    return runtime;
  });
}
