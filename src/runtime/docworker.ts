// ── documentation worker: `opm odd document` in a Pyodide of its own ──────
// A TEI customization takes the better part of a minute; run on the page it
// would freeze the editor, so it runs here and reports progress as it goes.
import type { PyodideAPI } from 'pyodide';
import { createRuntime } from './pyodide.ts';
import type { ProjectFiles } from '../project/zip.ts';

/** From the page: build the site for `odd` in `files`; `tei` is the TEI schema, once asked for. */
export interface DocRequest { files: ProjectFiles; odd: string; tei?: Uint8Array }
export type DocMessage =
  | { type: 'progress'; label: string; done: number; total: number }
  | { type: 'needTei' }
  | { type: 'done'; files: Record<string, Uint8Array>; landing: string }
  | { type: 'error'; message: string };

const ROOT = '/project', OUT = '/tmp/odd-docs';
let runtime: Promise<PyodideAPI> | null = null;
const post = (m: DocMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async ({ data }: MessageEvent<DocRequest>) => {
  try {
    // steps only: the bytes come from the service worker's cache, so a filling bar would read as a second download
    let step = '';
    runtime ??= createRuntime(label => {
      if (label !== step) post({ type: 'progress', label: label === 'Loading Python…' ? 'Starting Python in the background…' : label, done: 0, total: 0 });
      step = label;
    });
    const py = await runtime;
    if (data.tei) py.globals.get('install_tei')(data.tei);
    py.globals.get('reset_dir')(ROOT);
    for (const [p, v] of Object.entries(data.files)) {
      py.FS.mkdirTree((ROOT + '/' + p).replace(/\/[^/]*$/, ''));
      py.FS.writeFile(ROOT + '/' + p, v);
    }
    const progress = (done: number, total: number, label: string) => post({ type: 'progress', label: 'Writing ' + label, done, total });
    const r = JSON.parse(py.globals.get('document_odd')(ROOT, data.odd, OUT, progress));
    if (r.needTei) { post({ type: 'needTei' }); return; }
    const files: Record<string, Uint8Array> = {};
    for (const p of r.files as string[]) files[p] = py.FS.readFile(OUT + '/' + p);
    post({ type: 'done', files, landing: r.landing }, Object.values(files).map(f => f.buffer as ArrayBuffer));
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
