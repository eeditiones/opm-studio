// ── preferences: font, indentation and wrapping of the editor panel, and the size of the ODD form fields, kept per browser
import { remeasureEditors, setLayout } from './codemirror.ts';
import { $ } from './dom.ts';

const KEY = 'opm-editor';
const SYSTEM = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
// `google` names a family loaded from Google Fonts the first time it is chosen
const FONTS: Record<string, { label: string; stack?: string; google?: string }> = {
  jetbrains: { label: 'JetBrains Mono' },
  system: { label: 'System monospace', stack: SYSTEM },
  fira: { label: 'Fira Code', stack: '"Fira Code", ' + SYSTEM, google: 'Fira+Code:wght@400;500;600' },
  source: { label: 'Source Code Pro', stack: '"Source Code Pro", ' + SYSTEM, google: 'Source+Code+Pro:wght@400;500;600' },
  plex: { label: 'IBM Plex Mono', stack: '"IBM Plex Mono", ' + SYSTEM, google: 'IBM+Plex+Mono:wght@400;500;600' },
  custom: { label: 'Other installed font…' },
};
const DEFAULTS = { font: 'jetbrains', custom: '', size: 12.5, oddSize: 12.5, tabSize: 4, wrap: false };
const TAB_SIZES = [2, 3, 4, 8];
type Prefs = typeof DEFAULTS;

function load(): Prefs {
  try {
    const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } as Prefs;
    if (!FONTS[p.font]) p.font = DEFAULTS.font;
    if (!TAB_SIZES.includes(p.tabSize)) p.tabSize = DEFAULTS.tabSize;
    return p;
  } catch { return { ...DEFAULTS }; }
}

function save(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

const clampSize = (n: number, fallback = DEFAULTS.size) => Number.isFinite(n) ? Math.min(28, Math.max(9, n)) : fallback;

function stackOf(p: Prefs): string {
  if (p.font === 'custom') {
    const name = p.custom.replace(/["\\;{}]/g, '').trim();
    return name ? `"${name}", ${SYSTEM}` : '';
  }
  return FONTS[p.font].stack ?? '';
}

function loadFont(id: string): void {
  const family = FONTS[id]?.google;
  if (!family || document.getElementById('font-' + id)) return;
  const link = Object.assign(document.createElement('link'), { id: 'font-' + id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${family}&display=swap` });
  document.head.append(link);
  link.onload = () => void document.fonts.ready.then(remeasureEditors);
}

/** Set the font of the editor panel, the ODD form fields and the sample in the dialog; unset means the app's own. */
function apply(p: Prefs): void {
  loadFont(p.font);
  const stack = stackOf(p), size = clampSize(p.size);
  for (const node of [$('src'), $('oddvis'), $('pref-sample')]) {
    if (stack) node.style.setProperty('--editor-font', stack); else node.style.removeProperty('--editor-font');
    if (size !== DEFAULTS.size) node.style.setProperty('--editor-size', size + 'px'); else node.style.removeProperty('--editor-size');
  }
  $('oddvis').style.setProperty('--odd-size', clampSize(p.oddSize, DEFAULTS.oddSize) + 'px');
  setLayout({ tabSize: p.tabSize, wrap: p.wrap });
  remeasureEditors();
  void document.fonts.ready.then(remeasureEditors);
}

export function initPrefs(): void {
  const dlg = $<HTMLDialogElement>('prefs-dlg'), font = $<HTMLSelectElement>('pref-font');
  const custom = $<HTMLInputElement>('pref-custom'), size = $<HTMLInputElement>('pref-size'), oddSize = $<HTMLInputElement>('pref-odd-size');
  const tab = $<HTMLSelectElement>('pref-tab'), wrap = $<HTMLInputElement>('pref-wrap');
  font.replaceChildren(...Object.entries(FONTS).map(([id, f]) => new Option(f.label, id)));
  tab.replaceChildren(...TAB_SIZES.map(n => new Option(`${n} spaces`, String(n))));
  let prefs = load();
  apply(prefs);

  const show = () => {
    font.value = prefs.font; custom.value = prefs.custom; size.value = String(prefs.size); oddSize.value = String(prefs.oddSize);
    tab.value = String(prefs.tabSize); wrap.checked = prefs.wrap;
    $('pref-custom-row').hidden = prefs.font !== 'custom';
  };
  const update = () => {
    prefs = { font: font.value, custom: custom.value, size: clampSize(size.valueAsNumber), oddSize: clampSize(oddSize.valueAsNumber, DEFAULTS.oddSize), tabSize: Number(tab.value), wrap: wrap.checked };
    $('pref-custom-row').hidden = prefs.font !== 'custom';
    apply(prefs); save(prefs);
  };
  font.onchange = () => { update(); if (font.value === 'custom') custom.focus(); };
  custom.oninput = update;
  tab.onchange = update;
  wrap.onchange = update;
  size.oninput = () => { if (size.value && Number.isFinite(size.valueAsNumber)) update(); };
  size.onchange = () => { update(); size.value = String(prefs.size); };
  oddSize.oninput = () => { if (oddSize.value && Number.isFinite(oddSize.valueAsNumber)) update(); };
  oddSize.onchange = () => { update(); oddSize.value = String(prefs.oddSize); };
  $('pref-reset').onclick = () => { prefs = { ...DEFAULTS }; show(); apply(prefs); save(prefs); };
  $('prefs').onclick = () => { show(); dlg.showModal(); font.focus(); };
}
