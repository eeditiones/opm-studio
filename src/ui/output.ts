// ── output pane: mode tabs, template menu, transform and result ───────────
import { setMode } from '../actions.ts';
import { EXT, PREVIEW, TEMPLATE_KIND, type Mode } from '../config.ts';
import { base, config, oddPath, projectFiles, readText, snapshot, writeFile } from '../project/fs.ts';
import { setToml, tomlString, unsetToml } from '../project/toml.ts';
import { chunk, convert, pageSite, ready } from '../runtime/opm.ts';
import { documentOdd } from '../runtime/docs.ts';
import { py } from '../runtime/pyodide.ts';
import { toZip } from '../project/zip.ts';
import { emit, on, state } from '../state.ts';
import type { EditorView } from 'codemirror';
import { createViewer, type EditorKind } from './codemirror.ts';
import { $, download, el } from './dom.ts';
import { DOWNLOAD } from './icons.ts';
import { markdownFrame } from './previews/markdown.ts';
import { compilePdf } from './previews/pdf.ts';
import { framePage, publishSite, servedByWorker } from './previews/site.ts';
import { setStatus } from './status.ts';

/** A folder of pages (chunked output, ODD documentation), served from `base` by the service worker. */
interface Site { files: string[]; landing: string; base: string; read: (p: string) => Uint8Array; zip: string }
interface Result { mode: Mode; name: string; result: string | Uint8Array | Site }
let last: Result | null = null;
/** Bumped by every result shown, so a slow preview (PDF, Markdown) cannot overwrite a newer one. */
let seq = 0;

// ── transform ─────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false, again = false, queued = false;

/** Transform after a pause in typing. */
const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 600); };
/** Transform once, however many changes asked for it in the same turn. */
function requestRun(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; void run(); });
}

async function run(): Promise<void> {
  clearTimeout(timer);
  if (!ready() || !state.project || state.docs) return;
  if (!state.xml) {
    last = null; hideDownload();
    showError('This project has no XML source yet. Upload one, or add a file under data/.');
    setStatus('No XML source', 'err');
    return;
  }
  if (running) { again = true; return; }
  running = true; again = false;
  setStatus('Transforming…', 'busy');
  await new Promise(r => setTimeout(r, 30)); // let the UI paint
  const t = performance.now();
  try {
    last = { mode: state.mode, name: base(state.xml), result: state.mode === 'chunk' ? await chunkSite() : convert(state.dir, state.xml, state.mode) };
    showResult(last);
    setStatus('Up to date · ' + Math.round(performance.now() - t) + ' ms');
  } catch (err) {
    last = null; hideDownload();
    showError(String(err).split('\n').filter(Boolean).slice(-4).join('\n'));
    setStatus('Error', 'err');
  }
  running = false;
  if (again) void run();
}

/** Chunk the source outside the project folder, so its pages are not saved or synced as project files. */
async function chunkSite(): Promise<Site> {
  const out = '/tmp/opm-chunks/' + state.project;
  const { files, landing } = chunk(state.dir, state.xml, out);
  const read = (p: string) => py.FS.readFile(out + '/' + p) as Uint8Array;
  return { files, landing, read, zip: base(state.xml).replace(/\.[^.]+$/, '') + '-site.zip', base: await publishSite(files, read) };
}

// ── ODD documentation: built on request in a worker, shown in place of the output ──
let documenting = false;

async function runDocs(): Promise<void> {
  const odd = state.docs;
  if (documenting || !odd) return;
  documenting = true;
  viewer?.destroy(); viewer = null;
  clearOut(); hideDownload();
  const my = seq;
  const label = el('div', { textContent: 'Starting…' }), bar = el('progress');
  const box = el('div', { className: 'docs-progress' });
  box.append(el('strong', { textContent: 'Documenting ' + odd }), label, bar,
    el('p', { className: 'hint', textContent: 'A TEI customization is merged onto the whole TEI schema, which can take a minute. You can keep editing meanwhile.' }));
  $('out').append(box);
  setStatus('Documenting ' + base(odd) + '…', 'busy');
  const t = performance.now();
  try {
    const docs = await documentOdd(snapshot(), odd, (text, done, total) => {
      label.textContent = text + (total > 0 && total !== 100 ? ` · ${done} of ${total}` : '');
      if (total > 0) { bar.max = total; bar.value = done; } else bar.removeAttribute('value');
    });
    const files = Object.keys(docs.files), read = (p: string) => docs.files[p];
    const s: Site = { files, landing: docs.landing, read, zip: base(odd).replace(/\.[^.]+$/, '') + '-docs.zip', base: await publishSite(files, read) };
    if (my === seq && state.docs === odd) {
      showSite(s);
      setStatus(`Documented · ${files.filter(f => f.endsWith('.html')).length} pages · ${Math.round((performance.now() - t) / 1000)} s`);
    }
  } catch (err) {
    if (my === seq && state.docs === odd) {
      showError('Could not document ' + odd + ':\n' + String((err as Error).message ?? err).split('\n').filter(Boolean).slice(-4).join('\n'));
      setStatus('Error', 'err');
    }
  }
  documenting = false;
  // asked for again (another ODD, or the same after edits) while this one was running
  if (state.docs && state.docs !== odd) void runDocs();
}

// ── result ────────────────────────────────────────────────────────────────
export function clearOut(): void {
  seq++;
  for (const c of [...$('out').children]) if (c.id !== 'bar') c.remove();
  $('out').classList.remove('stage');
}
function showError(text: string): void {
  clearOut();
  $('out').append(el('pre', { className: 'err', textContent: text }));
}
const hideDownload = () => { $('download').hidden = true; };
function setDownload(file: string, onclick: () => void): void {
  const dl = $<HTMLButtonElement>('download');
  dl.innerHTML = DOWNLOAD; dl.append(file); dl.dataset.tip = 'Download ' + file; dl.hidden = false;
  dl.onclick = onclick;
}

/** Show a preview on paper over a neutral ground, apart from the app's own chrome. */
function showOnPaper(frame: HTMLIFrameElement): void {
  const paper = el('div', { className: 'paper' });
  paper.append(frame);
  $('out').classList.add('stage'); $('out').append(paper);
}

function showResult({ mode, name, result }: Result): void {
  if (typeof result === 'object' && 'base' in result) { showSite(result); return; }
  // keep the scroll position when the same file is regenerated
  const key = mode + ':' + name;
  const scroll = viewer && viewerKey === key ? viewer.scrollSnapshot() : null;
  const pageY = pageFrame && pageKey === key ? frameScroll(pageFrame) : 0;
  viewer?.destroy(); viewer = null;
  clearOut();
  const my = seq;
  const file = name.replace(/\.[^.]+$/, '') + '.' + EXT[mode];
  const save = () => download(file, result as BlobPart, typeof result === 'string' ? 'text/plain' : 'application/octet-stream');
  setDownload(file, save);
  const rendered = PREVIEW.has(mode) && state.view === 'rendered';
  if (typeof result !== 'string') {
    const card = el('div', { className: 'filecard' });
    const btn = el('button', { className: 'btn primary', textContent: '↓ Download', onclick: save });
    card.append(el('div', { className: 'ico', textContent: mode === 'epub' ? '📖' : '📄' }),
      el('div', { className: 'name', textContent: file }),
      el('div', { className: 'size', textContent: (result.length / 1024).toFixed(1) + ' KB · binary output' }), btn);
    $('out').append(card);
  } else if (mode === 'typst' && rendered) {
    void showPdf(name, result, my);
  } else if (mode === 'markdown' && rendered) {
    markdownFrame(result).then(f => { if (my === seq) showOnPaper(f); }, err => { if (my === seq) showError(String(err)); });
  } else if (rendered) {
    showPage(mode, name, result, key, pageY, my);
  } else {
    showSource(result, mode, key, scroll);
  }
}

// ── web and print pages: on their own, or with the assets their template links ──
let pageFrame: HTMLIFrameElement | null = null, pageKey = '';
const frameScroll = (f: HTMLIFrameElement) => { try { return f.contentWindow?.scrollY ?? 0; } catch { return 0; } };

/**
 * Show a rendered page. When its template links assets ([transform.web] assets),
 * they are copied beside it as `opm transform -o` does, and the page is served
 * with them through the service worker; otherwise it needs nothing beside it.
 */
function showPage(mode: Mode, name: string, html: string, key: string, y: number, my: number): void {
  const page = name.replace(/\.[^.]+$/, '') + '.html', out = '/tmp/opm-page/' + state.project;
  let s;
  try { s = pageSite(state.dir, mode, page, html, out); }
  catch (err) { showError(String(err).split('\n').filter(Boolean).slice(-2).join('\n')); return; }
  const show = (frame: HTMLIFrameElement) => {
    // regenerated: back to where the reader was
    if (y) frame.addEventListener('load', () => frame.contentWindow?.scrollTo(0, y), { once: true });
    pageFrame = frame; pageKey = key;
    showOnPaper(frame);
  };
  if (!s) { show(el('iframe', { srcdoc: html })); return; }
  const { files } = s, read = (p: string) => py.FS.readFile(out + '/' + p) as Uint8Array;
  publishSite(files, read).then(base => { if (my === seq) show(el('iframe', { src: base + page })); },
    err => { if (my === seq) showError(String(err)); });
}

let site: { frame: HTMLIFrameElement; base: string } | null = null;

/** Show the chunked pages, staying on the page the reader had open if it still exists. */
function showSite(s: Site): void {
  const page = site && framePage(site.frame, site.base);
  viewer?.destroy(); viewer = null;
  clearOut();
  setDownload(s.zip, () => download(s.zip, toZip(Object.fromEntries(s.files.map(p => [p, s.read(p)]))) as BlobPart, 'application/zip'));
  const frame = el('iframe', { src: s.base + (page && s.files.includes(page) ? page : s.landing) });
  const my = seq;
  frame.addEventListener('load', () => {
    if (my === seq && !servedByWorker(frame)) showError('The preview frame bypassed the service worker, so its pages could not be served. '
      + 'This happens after a hard reload, or with “Bypass for network” on in the developer tools. Reload the page normally.');
  }, { once: true });
  site = { frame, base: s.base };
  showOnPaper(frame);
}

/** Beyond this size highlighting costs more than it helps; fall back to plain text. */
const HIGHLIGHT_LIMIT = 500_000;
const SOURCE_KIND: Partial<Record<Mode, EditorKind | 'json'>> = { web: 'html', print: 'html', json: 'json' };

let viewer: EditorView | null = null, viewerKey = '';

function showSource(text: string, mode: Mode, key: string, scroll: ReturnType<EditorView['scrollSnapshot']> | null): void {
  if (text.length > HIGHLIGHT_LIMIT) { $('out').append(el('pre', { textContent: text })); return; }
  const host = el('div', { className: 'source' });
  $('out').append(host);
  viewer = createViewer(host, text, SOURCE_KIND[mode] ?? ''); viewerKey = key;
  if (scroll) viewer.dispatch({ effects: scroll });
}

async function showPdf(name: string, source: string, my: number): Promise<void> {
  setStatus('Compiling PDF… (first time downloads the Typst compiler)', 'busy');
  try {
    const pdf = await compilePdf(source);
    if (my !== seq) return;
    const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
    $('out').append(el('iframe', { src: url }));
    const file = name.replace(/\.[^.]+$/, '') + '.pdf';
    setDownload(file, () => el('a', { href: url, download: file }).click());
    setStatus('PDF ready');
  } catch (err) {
    if (my !== seq) return;
    showError('PDF compilation failed:\n' + String((err as Error).message || err));
    setStatus('Error', 'err');
  }
}

// ── modes, view toggle, templates, command line ───────────────────────────
/** When the modes scroll (a narrow output pane), keep the chosen one in sight; run after layout. */
function revealMode(): void {
  const modes = $('modes'), b = modes.querySelector<HTMLElement>('[aria-pressed=true]');
  if (!b || modes.scrollWidth <= modes.clientWidth) return;
  const r = b.getBoundingClientRect(), box = modes.getBoundingClientRect();
  if (r.left < box.left) modes.scrollLeft -= box.left - r.left;
  else if (r.right > box.right) modes.scrollLeft += r.right - box.right;
}

function updateModeUi(): void {
  for (const b of $('modes').children as HTMLCollectionOf<HTMLElement>) b.setAttribute('aria-pressed', String(!state.docs && b.dataset.mode === state.mode));
  requestAnimationFrame(revealMode);
  $('out-mode').textContent = state.docs ? 'documentation' : state.mode;
  $('docs-bar').hidden = !state.docs; $('docs-odd').textContent = state.docs;
  const view = $('view'), preview = PREVIEW.has(state.mode) && !state.docs;
  view.hidden = !preview;
  view.firstElementChild!.textContent = state.mode === 'typst' ? 'PDF' : 'Rendered';
  view.lastElementChild!.textContent = ({ markdown: 'Markdown', typst: 'Typst' } as Partial<Record<Mode, string>>)[state.mode] || 'HTML';
  if (!preview) state.view = 'code';
  else if (state.view === 'code' && !view.dataset.touched) state.view = 'rendered';
  for (const b of view.children as HTMLCollectionOf<HTMLElement>) b.setAttribute('aria-pressed', String(b.dataset.v === state.view));
}

// the template menu lists the project's own templates; its choice is written to opm.toml
function refreshTemplates(): void {
  const kind = state.docs ? undefined : TEMPLATE_KIND[state.mode];
  $('tpl-field').hidden = !kind || !state.project;
  if (!kind || !state.project) return;
  const sel = $<HTMLSelectElement>('tpl');
  sel.replaceChildren(new Option('opm default', ''));
  const suffix = kind === 'html' ? /\.html\.j2$/ : /\.typ\.j2$/;
  // opm/ holds the base templates the others extend (opm init --base): not pages of their own
  for (const p of projectFiles().filter(p => suffix.test(p) && !/(^|\/)opm\//.test(p))) sel.append(new Option(p, p));
  const cur = tomlString(config(), 'transform.' + state.mode, 'template');
  if (cur && ![...sel.options].some(o => o.value === cur)) sel.append(new Option(cur + ' (missing)', cur));
  sel.value = cur;
}

function updateCommand(): void {
  if (!state.project) { $('cmd').textContent = ''; $('warn').hidden = true; return; }
  $('cmd').textContent = state.docs ? `$ opm odd document ${state.docs} --force --preview`
    : state.mode === 'chunk'
    ? `$ opm chunk ${state.xml || '<no XML source>'} --force --preview`
    : `$ opm transform ${state.xml || '<no XML source>'} -t ${state.mode} -o output.${EXT[state.mode]}`;
  const w = mismatch();
  $('warn').hidden = !w; $('warn').textContent = w;
}

/** Warn when the bundled ODD in use does not match the document's vocabulary. */
function mismatch(): string {
  const src = state.xml ? readText(state.xml) : '', odd = base(oddPath());
  const root = src.match(/<(?!\?|!)([\w:.-]+)/)?.[1] ?? '';
  const head = src.slice(0, 2000);
  const kind = /^(TEI|tei:TEI)$/.test(root) ? 'tei'
    : /docbook\.org\/ns\/docbook|docbook\.org\/schema|<!DOCTYPE[^>]*docbook/i.test(head) ? 'docbook'
    : /^(article|book|chapter|section)$/.test(root) && /dtd-version|<!DOCTYPE[^>]*(jats|journalpublishing|archiving)/i.test(head) ? 'jats' : '';
  const expect = ({ 'teipublisher.odd': 'tei', 'jats.odd': 'jats', 'docbook.odd': 'docbook' } as Record<string, string>)[odd];
  return kind && expect && kind !== expect ? `⚠ ${odd} is meant for ${expect.toUpperCase()}, but the source looks like ${kind.toUpperCase()}.` : '';
}

export function initOutput(): void {
  // the buttons and their descriptions are in index.html
  for (const b of $('modes').children as HTMLCollectionOf<HTMLElement>) b.onclick = () => setMode(b.dataset.mode as Mode);
  new ResizeObserver(revealMode).observe($('modes'));
  const view = $('view');
  for (const b of view.children as HTMLCollectionOf<HTMLElement>) b.onclick = () => {
    state.view = b.dataset.v as typeof state.view; view.dataset.touched = '1';
    for (const x of view.children) x.setAttribute('aria-pressed', String(x === b));
    if (last) showResult(last);
  };
  $('tpl').onchange = () => {
    const v = $<HTMLSelectElement>('tpl').value, sec = 'transform.' + state.mode, toml = readText('opm.toml');
    writeFile('opm.toml', v ? setToml(toml, sec, 'template', v) : unsetToml(toml, sec, 'template'));
    emit('files');
  };
  $('copy-cmd').onclick = () => {
    try { void navigator.clipboard.writeText(($('cmd').textContent ?? '').replace(/^\$ /, '')); } catch {}
    $('copy-cmd').textContent = 'Copied';
    setTimeout(() => $('copy-cmd').textContent = 'Copy', 1400);
  };

  on('project', () => {
    updateModeUi(); refreshTemplates(); updateCommand();
    if (state.project) requestRun(); else { last = null; clearOut(); hideDownload(); }
  });
  $('docs-rebuild').onclick = () => void runDocs();
  $('docs-close').onclick = () => setMode(state.mode);
  on('docs', () => { updateModeUi(); refreshTemplates(); updateCommand(); if (state.docs) void runDocs(); else requestRun(); });
  on('source', () => { updateModeUi(); refreshTemplates(); updateCommand(); requestRun(); });
  on('files', () => { refreshTemplates(); updateCommand(); requestRun(); });
  on('config', () => { refreshTemplates(); updateCommand(); });
  on('edit', schedule);
  updateModeUi();
}
