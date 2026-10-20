// ── header: project switcher and export ───────────────────────────────────
import { persistNow } from '../project/autosave.ts';
import { snapshot } from '../project/fs.ts';
import { canUseFolders } from '../project/folder.ts';
import { listProjects } from '../project/store.ts';
import { toZip } from '../project/zip.ts';
import { on, state } from '../state.ts';
import { $, download, el } from './dom.ts';
import { openSaved, showStart } from './start.ts';
import { chooseFolder, confirmUnlink } from './sync.ts';

function closeMenu(): void {
  $('proj-pop').hidden = true;
  $('proj-menu').setAttribute('aria-expanded', 'false');
}

function item(label: string, onclick: () => void, { mono = false, checked }: { mono?: boolean; checked?: boolean } = {}): HTMLButtonElement {
  const b = el('button', { onclick: () => { closeMenu(); onclick(); } });
  b.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
  if (checked !== undefined) b.setAttribute('aria-checked', String(checked));
  const nm = el('span', { className: 'nm', textContent: label });
  if (!mono) nm.style.fontFamily = 'var(--sans)';
  b.append(el('span', { className: 'ck', textContent: checked ? '✓' : '' }), nm);
  return b;
}

// saved projects, newest first, then the start page for anything else
async function openMenu(): Promise<void> {
  const pop = $('proj-pop'), btn = $('proj-menu');
  const projects = await listProjects();
  pop.replaceChildren(...projects.map(({ name }) => item(name, () => { if (name !== state.project) void openSaved(name); },
    { mono: true, checked: name === state.project })));
  pop.append(el('hr'), item('All projects…', () => showStart(true)));
  if (canUseFolders()) pop.append(el('hr'), state.folder
    ? item('Stop syncing with ' + state.folder.name, () => void confirmUnlink())
    : item('Sync with folder…', () => void chooseFolder()));
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.max(16, r.left) + 'px'; pop.style.top = (r.bottom + 4) + 'px';
  pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
  (pop.querySelector<HTMLElement>('[aria-checked=true]') ?? pop.querySelector('button'))?.focus();
}

export function initSwitcher(): void {
  $('proj-menu').onclick = () => void ($('proj-pop').hidden ? openMenu() : closeMenu());
  document.addEventListener('pointerdown', e => {
    if (!$('proj-pop').hidden && !(e.target as Element).closest('#proj-pop, #proj-menu')) closeMenu();
  });
  $('proj-pop').addEventListener('keydown', e => {
    const items = [...$('proj-pop').querySelectorAll('button')], i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { closeMenu(); $('proj-menu').focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Tab') closeMenu();
  });
  $('proj-export').onclick = async () => {
    await persistNow();
    download(state.project + '.zip', toZip(snapshot()) as BlobPart, 'application/zip');
  };
  on('project', () => {
    $('proj-name').textContent = state.project ?? '';
    for (const id of ['proj-menu', 'slash', 'proj-export']) $(id).hidden = !state.project;
  });
}
