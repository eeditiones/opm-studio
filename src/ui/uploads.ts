// ── uploads: one entry point, files land in the folder opm expects ────────
import { showFile } from '../actions.ts';
import { base, config, dirOf, extOf, oddPath, projectFiles, readText, writeFile } from '../project/fs.ts';
import { setToml, tomlString } from '../project/toml.ts';
import { isText } from '../project/zip.ts';
import { emit, state } from '../state.ts';
import { ask } from './dialog.ts';
import { $ } from './dom.ts';
import { importZip } from './start.ts';

interface Batch { hasOdd: boolean; odds: string[] }
const looksLikeOdd = (name: string, text: string) => extOf(name) === 'odd' || /<schemaSpec/.test(text.slice(0, 20000));

/** The uploaded RELAX NG files no other one includes: a schema split over several files has one. */
function schemaRoots(items: { name: string; data: string | Uint8Array }[]): string[] {
  const rngs = items.filter((i): i is { name: string; data: string } => extOf(i.name) === 'rng' && typeof i.data === 'string');
  const linked = new Set(rngs.flatMap(r => [...r.data.matchAll(/<(?:\w+:)?(?:include|externalRef)\b[^>]*\bhref\s*=\s*["']([^"']+)["']/g)].map(m => base(m[1]))));
  return rngs.map(r => r.name).filter(n => !linked.has(n));
}

/** Where an uploaded file belongs when it was not dropped onto a folder. */
function targetDir(name: string, text: string, batch: Batch): string {
  const e = extOf(name);
  if (name === 'opm.toml') return '';
  if (e === 'odd' || (/^(xml|tei)$/.test(e) && looksLikeOdd(name, text))) return 'odd/';
  if (e === 'rng') return 'schema/';
  if (/^(xml|tei|xhtml)$/.test(e)) return 'data/';
  if (e === 'css') {
    // a stylesheet an ODD refers to sits beside it; anything else styles a template
    const refd = [...projectFiles().filter(p => extOf(p) === 'odd').map(readText), ...batch.odds].join('\n');
    return refd.includes(name) || batch.hasOdd ? 'odd/' : 'templates/';
  }
  return 'templates/';
}

async function takeFiles(list: FileList | File[], folder?: string): Promise<void> {
  const files = [...list];
  if (!files.length) return;
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) return importZip(files[0]);
  if (!state.project) return;
  const items = await Promise.all(files.map(async f => ({ name: f.name, data: isText(f.name) ? await f.text() : new Uint8Array(await f.arrayBuffer()) })));
  const odds = items.filter((i): i is { name: string; data: string } => typeof i.data === 'string' && looksLikeOdd(i.name, i.data));
  const batch: Batch = { hasOdd: odds.length > 0, odds: odds.map(o => o.data) };
  const roots = schemaRoots(items);
  let last = '', newOdd = '', newXml = '', newSchema = '';
  for (const it of items) {
    const dir = folder ?? targetDir(it.name, typeof it.data === 'string' ? it.data : '', batch);
    const p = dir + it.name;
    writeFile(p, it.data); last = p;
    if (odds.some(o => o.name === it.name)) newOdd = p;
    else if (/^(xml|tei|xhtml)$/.test(extOf(p)) && dir === 'data/') newXml = p;
    else if (roots.length === 1 && it.name === roots[0]) newSchema = p;
  }
  if (newOdd && oddPath() !== newOdd && await ask({ title: 'Use as project ODD?', name: newOdd, text: ' was added. Make it the ODD this project transforms with?', ok: 'Use it' })) {
    writeFile('opm.toml', setToml(readText('opm.toml'), 'transform', 'odd', newOdd));
  }
  if (newSchema && tomlString(config(), 'editor', 'schema') !== newSchema && await ask({ title: 'Use as project schema?', name: newSchema, text: ' was added. Make it the schema the editor checks documents against and suggests elements and attributes from, for every document without an <?xml-model?> of its own?', ok: 'Use it' })) {
    writeFile('opm.toml', setToml(readText('opm.toml'), 'editor', 'schema', newSchema));
  }
  if (newXml) state.xml = newXml;
  emit('files', 'source');
  showFile(last);
}

export function initUploads(): void {
  $('upload').onclick = () => $('file-up').click();
  $('dropzone').onclick = () => $('file-up').click();
  $<HTMLInputElement>('file-up').onchange = e => {
    const input = e.target as HTMLInputElement;
    if (input.files) void takeFiles(input.files);
    input.value = '';
  };

  let depth = 0;
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const overlay = (on: boolean) => { $('explorer').classList.toggle('over', on); $('drop-overlay').classList.toggle('on', on); };
  const clearTargets = () => document.querySelectorAll('.dropover').forEach(r => r.classList.remove('dropover'));
  addEventListener('dragenter', e => {
    if (!hasFiles(e) || !state.project) return;
    depth++; overlay(true);
    $('drop-msg').textContent = 'Drop to add to ' + state.project;
  });
  addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; overlay(false); } });
  addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); clearTargets();
    (e.target as Element).closest?.('#tree .row')?.classList.add('dropover');
  });
  addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay(false); clearTargets();
    // dropped on a folder row: into that folder; on a file row: beside the file
    const row = (e.target as Element).closest?.<HTMLElement>('#tree .row');
    const folder = row ? (row.dataset.dir ? row.dataset.path + '/' : dirOf(row.dataset.path ?? '')) : undefined;
    if (e.dataTransfer) void takeFiles(e.dataTransfer.files, folder);
  });
}
