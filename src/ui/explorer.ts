// ── explorer: the pipeline summary and the file tree ──────────────────────
import { openFile, showFile } from '../actions.ts';
import { TEMPLATE_KIND } from '../config.ts';
import { abs, base, dirOf, exists, firstXml, renamePath, walk, writeFile, type Entry } from '../project/fs.ts';
import { pipelineFiles, roleOf } from '../project/pipeline.ts';
import { removePath } from '../runtime/opm.ts';
import { emit, on, state } from '../state.ts';
import { ask, confirmDelete, notify } from './dialog.ts';
import { $, el } from './dom.ts';
import { icon } from './icons.ts';

const collapsed = new Set<string>();

function renderTree(): void {
  const tree = $('tree');
  tree.replaceChildren();
  renderPipeline();
  if (!state.project) return;
  const items = walk(), pipeline = pipelineFiles();
  const sorted = [...items.filter(f => f.path === 'opm.toml'), ...foldersFirst(items).filter(f => f.path !== 'opm.toml')];
  for (const f of sorted) {
    if ([...collapsed].some(c => f.path.startsWith(c + '/'))) continue;
    const role = f.dir ? '' : roleOf(f.path, pipeline);
    const row = el('div', { className: 'row' + (f.dir ? ' dir' : '') + (f.path === state.file ? ' sel' : '') });
    row.style.setProperty('--d', String(f.path.split('/').length - 1));
    row.dataset.path = f.path; row.dataset.dir = f.dir ? '1' : '';
    row.innerHTML = '<span class="cr"></span><span class="tg"></span><span class="nm"></span><span class="rd"></span><span class="act"><button data-a="ren" aria-label="Rename">✎</button><button data-a="del" aria-label="Delete">✕</button></span>';
    const [cr, tg, nm, rd] = row.children as unknown as HTMLElement[];
    cr.textContent = f.dir ? (collapsed.has(f.path) ? '▸' : '▾') : '';
    tg.textContent = f.dir ? '' : icon(f.path);
    nm.textContent = base(f.path);
    if (role && role !== 'Project config') rd.dataset.tip = role; else rd.remove();
    row.onclick = e => {
      const a = (e.target as Element).closest('button')?.dataset.a;
      if (a === 'del') return void deleteEntry(f);
      if (a === 'ren') return void renameEntry(f);
      if (f.dir) { collapsed.has(f.path) ? collapsed.delete(f.path) : collapsed.add(f.path); renderTree(); }
      else openFile(f.path);
    };
    tree.append(row);
  }
}

// the files opm.toml says take part in a transform, in the order they are used
function renderPipeline(): void {
  const box = $('pipeline');
  box.replaceChildren();
  box.hidden = !state.project;
  if (!state.project) return;
  box.append(el('div', { className: 'cap', textContent: 'Pipeline' }));
  const f = pipelineFiles();
  const rows: [string, string, string][] = [['Source', f.source, 'none'], ['ODD', f.odd, 'none']];
  if (TEMPLATE_KIND[state.mode]) rows.push(['Template', f.template, 'opm default']);
  for (const [role, p, none] of rows) {
    const there = !!p && exists(p);
    const b = el('button', { className: 'pipe' + (!p ? ' off' : !there ? ' miss' : p === state.file ? ' on' : '') });
    if (p) b.dataset.tip = p;
    b.append(el('span', { className: 'r', textContent: role }),
      el('span', { className: 'n', textContent: p ? base(p) + (there ? '' : ' (missing)') : none }));
    if (there) b.onclick = () => openFile(p);
    box.append(b);
  }
}

// folders first within each directory, files after, as a file manager would list them
function foldersFirst(items: Entry[]): Entry[] {
  const byDir = new Map<string, Entry[]>();
  for (const f of items) { const d = dirOf(f.path); (byDir.get(d) ?? byDir.set(d, []).get(d)!).push(f); }
  const out: Entry[] = [];
  const visit = (d: string) => {
    const list = (byDir.get(d) ?? []).sort((a, b) => (Number(b.dir) - Number(a.dir)) || base(a.path).localeCompare(base(b.path)));
    for (const f of list) { out.push(f); if (f.dir) visit(f.path + '/'); }
  };
  visit('');
  return out;
}

const inside = (p: string, f: Entry) => p === f.path || p.startsWith(f.path + '/');

async function deleteEntry(f: Entry): Promise<void> {
  if (!await confirmDelete(f.dir ? 'Delete folder?' : 'Delete file?', f.path, f.dir ? ' and everything in it will be removed.' : ' will be removed.')) return;
  removePath(abs(f.path));
  state.open = state.open.filter(p => !inside(p, f));
  if (inside(state.xml, f)) state.xml = firstXml();
  emit('files', 'source');
  if (inside(state.file, f)) showFile(state.open[0] || '');
}

async function renameEntry(f: Entry): Promise<void> {
  const to = (await ask({ title: f.dir ? 'Rename folder' : 'Rename file', text: 'New path, relative to the project root.', ok: 'Rename', input: f.path }))?.trim();
  if (!to || to === f.path) return;
  if (exists(to)) return void notify('Already exists', ' exists already.', to);
  renamePath(f.path, to);
  const re = (p: string) => p === f.path ? to : p.startsWith(f.path + '/') ? to + p.slice(f.path.length) : p;
  state.open = state.open.map(re); state.xml = re(state.xml);
  emit('files', 'source');
  showFile(re(state.file));
}

async function newFile(): Promise<void> {
  const p = (await ask({ title: 'New file', text: 'Path, relative to the project root, e.g. templates/my.html.j2.', ok: 'Create', input: 'templates/' }))?.trim();
  if (!p || p.endsWith('/')) return;
  if (!exists(p)) { writeFile(p, ''); emit('files'); }
  openFile(p);
}

export function initExplorer(): void {
  $('new-file').onclick = () => void newFile();
  on(['project', 'files', 'config', 'file', 'source'], renderTree);
}
