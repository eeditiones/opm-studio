// ── source editor: tabs, breadcrumbs, CodeMirror or a binary preview ──────
import { closeTab, documentOdd, openFile } from '../actions.ts';
import { IMAGES } from '../config.ts';
import { base, dirOf, exists, extOf, isOdd, normPath, readBytes, readText, writeFile } from '../project/fs.ts';
import { roleOf } from '../project/pipeline.ts';
import { isText } from '../project/zip.ts';
import { emit, on, state } from '../state.ts';
import { createEditor, type EditorKind } from './codemirror.ts';
import { schemaFor } from './xmlSchema.ts';
import { $, el } from './dom.ts';
import { icon } from './icons.ts';
import { formatOdd } from '../odd/oddFormat.ts';
import { packagedOdd } from '../runtime/opm.ts';
import type { OddEditor, OddHost } from './odd/odd-editor.ts';
import './odd/odd-editor.ts';

let editor: ReturnType<typeof createEditor>;
let oddEditor: OddEditor;
/** The ODD the visual editor last showed, so reopening it keeps the selection. */
let oddShown = '';

function editorKind(p: string): EditorKind {
  const e = extOf(p), n = base(p);
  if (e === 'toml') return 'toml';
  if (e === 'css') return 'css';
  if (e === 'py') return 'python';
  if (/\.html\.j2$|\.html?$/.test(n)) return 'html';
  if (e === 'j2') return 'jinja';
  if (['xml', 'odd', 'tei', 'xsd', 'rng', 'xsl', 'xslt', 'svg', 'xhtml'].includes(e)) return 'xml';
  return '';
}

const visualOdd = (p: string) => !!p && state.oddView === 'visual' && isOdd(p);

/** Show p's text, with autocompletion and validation from its schema when it is XML. */
function show(p: string): void {
  const text = readText(p), kind = editorKind(p);
  editor.setValue(text, kind);
  if (kind === 'xml') editor.useSchema(schemaFor(p, text));
}

function render(): void {
  const p = state.file, text = !!p && isText(p), visual = visualOdd(p);
  $('src').hidden = !text || visual; $('oddvis').hidden = !visual; $('preview').hidden = text || visual;
  if (visual) showOdd(p);
  else if (text) show(p);
  else if (p) showBinary(p);
  else showNothing();
  renderTabs(); renderKind();
}

/** Pick up changes made outside the editor, e.g. an upload or the template menu. */
function reload(): void {
  const p = state.file;
  if (visualOdd(p)) oddEditor.reload();
  else if (p && isText(p) && readText(p) !== editor.getValue()) show(p);
  renderTabs(); renderKind();
}

function showOdd(p: string): void {
  const host: OddHost = {
    read: () => readText(p),
    write(text) {
      writeFile(p, text);
      renderKind();
      emit('config', 'edit');
    },
    // A sibling file first, as opm resolves it, then the ODDs shipped with opm
    parent(source) {
      const sibling = normPath(dirOf(p) + source);
      return sibling !== p && exists(sibling) ? readText(sibling) : packagedOdd(source);
    },
    showSource: () => setOddView('source'),
  };
  oddEditor.channel = state.mode;
  oddEditor.open(host, p !== oddShown);
  oddShown = p;
}

function setOddView(v: typeof state.oddView): void {
  if (v === state.oddView) return;
  oddEditor.flush();
  state.oddView = v;
  render();
}

/** The last tab was closed: drop its text, so nothing stale stays in the editor. */
function showNothing(): void {
  editor.setValue('', '');
  $('preview').replaceChildren(el('p', { className: 'hint', textContent: 'No file open. Pick one in the file list.' }));
}

function showBinary(p: string): void {
  const pv = $('preview'), bytes = readBytes(p);
  pv.replaceChildren();
  if (IMAGES.has(extOf(p))) {
    pv.append(el('img', { src: URL.createObjectURL(new Blob([bytes as BlobPart])), alt: base(p) }));
  } else {
    const card = el('div', { className: 'filecard' });
    card.append(
      el('div', { className: 'ico', textContent: '📄' }),
      el('div', { className: 'name', textContent: base(p) }),
      el('div', { className: 'size', textContent: (bytes.length / 1024).toFixed(1) + ' KB · binary file' }),
    );
    pv.append(card);
  }
}

function renderTabs(): void {
  $('tabs').replaceChildren(...state.open.map(p => {
    const b = el('button', { className: 'tab' });
    b.dataset.tip = p;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(p === state.file));
    const x = el('span', { className: 'x', textContent: '×' });
    x.dataset.tip = 'Close';
    b.append(el('span', { className: 'ico', textContent: icon(p) }), el('span', { className: 'lbl', textContent: base(p) }), x);
    b.onclick = e => { if ((e.target as Element).classList.contains('x')) closeTab(p); else openFile(p); };
    return b;
  }));
}

function renderKind(): void {
  const p = state.file, crumbs = $('crumbs'), role = $('role');
  crumbs.replaceChildren(); role.hidden = true;
  if (!p) { $('kind').textContent = ''; return; }
  const parts = p.split('/');
  parts.forEach((seg, i) => {
    crumbs.append(el('span', { textContent: seg, className: i === parts.length - 1 ? 'last' : '' }));
    if (i < parts.length - 1) crumbs.append(el('span', { textContent: '/', className: 'sl' }));
  });
  const r = roleOf(p);
  if (r) { role.textContent = r; role.hidden = false; }
  const text = isText(p) ? readText(p) : '';
  const lines = text ? text.split('\n').length + ' lines' : '';
  const inherits = extOf(p) === 'odd' && text.match(/<schemaSpec[^>]*\ssource="([^"]+)"/)?.[1];
  $('kind').textContent = [inherits && 'inherits ' + inherits, lines].filter(Boolean).join(' · ');
  const odd = $('oddview');
  odd.hidden = !isOdd(p);
  $('fmt').hidden = !isOdd(p) || state.oddView === 'visual';
  $('odd-doc').hidden = !isOdd(p);
  for (const b of odd.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === state.oddView));
}

export function initEditor(): void {
  editor = createEditor($('src'), () => {
    if (!state.file) return;
    writeFile(state.file, editor.getValue());
    renderKind();
    // opm.toml and ODDs decide the pipeline; other files only change the output
    emit(state.file === 'opm.toml' || extOf(state.file) === 'odd' ? 'config' : 'edit', 'edit');
  });
  $('odd-doc').onclick = () => { if (state.file) { oddEditor.flush(); documentOdd(state.file); } };
  $('fmt').onclick = () => { if (state.file) editor.replace(formatOdd(editor.getValue())); };
  oddEditor = $<OddEditor>('oddvis');
  for (const b of $('oddview').children as HTMLCollectionOf<HTMLElement>) b.onclick = () => setOddView(b.dataset.v as typeof state.oddView);
  // The visual editor marks the rules that fire for the current output mode
  on('source', () => { oddEditor.channel = state.mode; });
  on('file', () => { oddEditor.flush(); render(); });
  on(['files', 'project'], reload);
  on(['config', 'source'], renderKind);
}
