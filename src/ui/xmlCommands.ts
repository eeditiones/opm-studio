// ── XML editing commands: surround with, select and remove an element ─────
// Shared by the source editor and the ODD editor's template fields. Each
// command has a shortcut and an entry in the editor's context menu.
import { EditorSelection, Facet, Prec, StateEffect, StateField, type EditorState, type Extension, type SelectionRange } from '@codemirror/state';
import { EditorView, keymap, showPanel, type Command, type Panel } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { el } from './dom.ts';

const isMac = /Mac|iP(hone|ad)/.test(navigator.platform);

/** A CodeMirror key name as the user sees it, e.g. Mod-Shift-e → ⇧⌘E or Ctrl+Shift+E. */
export const keyLabel = (key: string): string => {
  const parts = key.split('-'), last = parts.pop()!.toUpperCase();
  if (isMac) return parts.map(p => ({ Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' })[p] ?? p).sort((a, b) => '⌃⌥⇧⌘'.indexOf(a) - '⌃⌥⇧⌘'.indexOf(b)).join('') + last;
  return [...parts.map(p => (p === 'Mod' ? 'Ctrl' : p)), last].join('+');
};

/**
 * The element around a range. With `outer`, one that is larger than the range,
 * so that selecting the element again moves on to its parent.
 */
function elementAround(state: EditorState, range: SelectionRange, outer: boolean) {
  const tree = syntaxTree(state);
  // both sides, so a cursor right on a tag boundary still finds its element
  for (const side of [1, -1] as const) {
    for (let cur: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(range.from, side); cur; cur = cur.parent) {
      if (cur.name !== 'Element' || cur.from > range.from || cur.to < range.to) continue;
      if (!outer || range.empty || cur.from < range.from || cur.to > range.to) return cur;
    }
  }
  return null;
}

/** Select the element around the cursor; again for its parent. */
export const selectElement: Command = view => {
  view.dispatch(view.state.changeByRange(range => {
    const node = elementAround(view.state, range, true);
    return { range: node ? EditorSelection.range(node.from, node.to) : range };
  }), { scrollIntoView: true });
  return true;
};

/** Remove the tags of the element around the cursor, keeping its content selected. */
export const removeElement: Command = view => {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.changeByRange(range => {
    const node = elementAround(view.state, range, false);
    const open = node?.firstChild, close = node?.lastChild;
    if (open?.name === 'SelfClosingTag') {
      return { range: EditorSelection.cursor(open.from), changes: { from: open.from, to: open.to } };
    }
    // an element without its end tag is left alone
    if (!open || open.name !== 'OpenTag' || close?.name !== 'CloseTag') return { range };
    return {
      range: EditorSelection.range(open.from, close.from - (open.to - open.from)),
      changes: [{ from: open.from, to: open.to }, { from: close.from, to: close.to }],
    };
  }));
  return true;
}

/** Wrap each selection in an element named `tag`, keeping the text selected. */
function surround(view: EditorView, tag: string): void {
  const start = `<${tag}>`, end = `</${tag.split(/\s/)[0]}>`;
  view.dispatch(view.state.changeByRange(range => ({
    changes: [{ from: range.from, insert: start }, { from: range.to, insert: end }],
    range: EditorSelection.range(range.from + start.length, range.to + start.length),
  })));
}

// The element name is asked for in a panel below the text, not with window.prompt
const togglePrompt = StateEffect.define<boolean>();
const promptState = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(togglePrompt)) value = e.value;
    return value;
  },
  provide: f => showPanel.from(f, on => (on ? createPrompt : null)),
});

/** An element the schema allows at some point, with its short description. */
export interface AllowedElement { name: string; detail?: string }

/**
 * The elements allowed at a position, for an editor that knows its schema to
 * provide; null when it cannot tell, and the name is then typed freely.
 */
export const allowedElements = Facet.define<(state: EditorState, pos: number) => Promise<AllowedElement[] | null>>();

function createPrompt(view: EditorView): Panel {
  const input = el('input', { type: 'text', placeholder: 'Element name, with attributes if you like (Enter to confirm, Esc to cancel)' });
  input.setAttribute('aria-label', 'Surround with element');
  const list = el('ul', { className: 'cm-element-list', hidden: true });
  list.setAttribute('role', 'listbox');
  // null while unknown or without a schema: any name goes
  let allowed: AllowedElement[] | null = null, shown: AllowedElement[] = [], active = 0;

  const close = () => { if (view.state.field(promptState, false)) view.dispatch({ effects: togglePrompt.of(false) }); };
  const typedName = () => input.value.trim().split(/\s/)[0];

  function render(): void {
    if (!allowed) return;
    const typed = typedName().toLowerCase();
    // names starting with what is typed first, then those containing it
    shown = [...allowed.filter(a => a.name.toLowerCase().startsWith(typed)), ...allowed.filter(a => !a.name.toLowerCase().startsWith(typed) && a.name.toLowerCase().includes(typed))];
    active = Math.max(0, Math.min(active, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((a, i) => {
      const li = el('li', { onmousedown: e => { e.preventDefault(); choose(a.name); } });
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.append(el('span', { className: 'nm', textContent: a.name }), el('span', { className: 'dt', textContent: a.detail ?? '' }));
      return li;
    }) : [el('li', { className: 'none', textContent: allowed.length ? 'No allowed element matches' : 'The schema allows no element here' })]));
    list.hidden = false;
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  /** Wrap in `name`, keeping any attributes typed after the name. */
  function choose(name: string): void {
    const rest = input.value.trim().slice(typedName().length);
    close();
    surround(view, name + rest);
    view.focus();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); view.focus(); }
    else if (allowed && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      if (shown.length) active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      render();
    } else if (allowed && e.key === 'Tab' && shown[active]) {
      // complete the name, to go on with attributes
      e.preventDefault();
      input.value = shown[active].name + ' ' + input.value.trim().slice(typedName().length).trimStart();
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const name = typedName();
      // with a schema, only an element it allows: the one typed in full, else the one highlighted
      if (!allowed) { if (name) choose(name); }
      else if (allowed.some(a => a.name === name)) choose(name);
      else if (shown[active]) choose(shown[active].name);
    }
  });
  input.addEventListener('blur', close);

  const lookup = view.state.facet(allowedElements)[0];
  lookup?.(view.state, view.state.selection.main.from).then(found => {
    if (!found || !input.isConnected) return;
    allowed = [...found].sort((a, b) => a.name.localeCompare(b.name));
    input.placeholder = 'Element allowed here (↑↓ to choose, Tab to add attributes, Enter to confirm, Esc to cancel)';
    render();
  }, () => {});

  const dom = el('div', { className: 'cm-input-panel' });
  dom.append(list, input);
  return { top: false, dom, mount: () => input.focus() };
}

/** Ask for an element name and wrap the selection in it. */
export const surroundWithElement: Command = view => {
  if (view.state.readOnly) return false;
  view.dispatch({ effects: togglePrompt.of(!view.state.field(promptState, false)) });
  return true;
};

interface Entry { label: string; key?: string; run: (view: EditorView) => unknown }

export const XML_COMMANDS = {
  surround: { label: 'Surround with element…', key: 'Mod-e', run: surroundWithElement },
  select: { label: 'Select element', key: 'Mod-Shift-e', run: selectElement },
  remove: { label: 'Remove element tags', key: 'Mod-Shift-x', run: removeElement },
} satisfies Record<string, Entry>;

const clipboard: Entry[] = [
  { label: 'Cut', key: 'Mod-x', run: v => {
    const { from, to } = v.state.selection.main;
    if (from === to) return;
    void navigator.clipboard.writeText(v.state.sliceDoc(from, to));
    v.dispatch({ changes: { from, to }, userEvent: 'delete.cut' });
  } },
  { label: 'Copy', key: 'Mod-c', run: v => { const { from, to } = v.state.selection.main; void navigator.clipboard.writeText(v.state.sliceDoc(from, to)); } },
  { label: 'Paste', key: 'Mod-v', run: async v => {
    const text = await navigator.clipboard.readText().catch(() => null);
    if (text !== null) v.dispatch(v.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
  } },
];

let menu: HTMLElement | null = null;
const closeMenu = () => { menu?.remove(); menu = null; };

function openMenu(view: EditorView, x: number, y: number): void {
  closeMenu();
  const item = ({ label, key, run }: Entry) => {
    const b = el('button', { onclick: () => { closeMenu(); view.focus(); void run(view); } });
    b.setAttribute('role', 'menuitem');
    b.append(el('span', { className: 'nm', textContent: label }), el('span', { className: 'key', textContent: key ? keyLabel(key) : '' }));
    return b;
  };
  menu = el('div', { className: 'menu context-menu' });
  menu.setAttribute('role', 'menu');
  menu.append(...Object.values(XML_COMMANDS).map(item), el('hr'), ...clipboard.map(item));
  menu.addEventListener('keydown', e => {
    const items = [...menu!.querySelectorAll('button')], i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); view.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Tab') closeMenu();
  });
  document.body.append(menu);
  menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, y + menu.offsetHeight > innerHeight - 8 ? y - menu.offsetHeight : y) + 'px';
  menu.querySelector('button')!.focus();
}

document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target as Node)) closeMenu(); }, true);
addEventListener('blur', closeMenu);

const contextMenu = EditorView.domEventHandlers({
  contextmenu(e, view) {
    // Shift + right click still opens the browser's own menu
    if (e.shiftKey) return false;
    e.preventDefault();
    // a click outside the selection moves the cursor there, as in other editors
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos !== null && !view.state.selection.ranges.some(r => r.from <= pos && pos <= r.to)) {
      view.dispatch({ selection: { anchor: pos } });
    }
    openMenu(view, e.clientX, e.clientY);
    return true;
  },
});

const panelTheme = EditorView.theme({
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--line-2)' },
  '.cm-input-panel': { padding: '4px 6px' },
  '.cm-input-panel input': {
    width: '100%', boxSizing: 'border-box', height: '26px', padding: '0 6px',
    color: 'var(--fg)', backgroundColor: 'var(--panel)', border: '1px solid var(--btn-line)', borderRadius: '4px', fontFamily: 'var(--mono)',
  },
  '.cm-element-list': { listStyle: 'none', margin: '0 0 4px', padding: '0', maxHeight: '13.5em', overflowY: 'auto', fontFamily: 'var(--sans)', fontSize: '12px' },
  '.cm-element-list li': { display: 'flex', gap: '10px', padding: '3px 6px', borderRadius: '4px', cursor: 'pointer' },
  '.cm-element-list li[aria-selected=true]': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' },
  '.cm-element-list li.none': { color: 'var(--muted)', cursor: 'default' },
  '.cm-element-list .nm': { fontFamily: 'var(--mono)', flex: 'none' },
  '.cm-element-list .dt': { color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

/** The XML commands, their shortcuts and the context menu, for an editor showing XML. */
export const xmlCommands = (): Extension => [
  promptState, panelTheme, contextMenu,
  Prec.high(keymap.of(Object.values(XML_COMMANDS).map(({ key, run }) => ({ key, run, preventDefault: true })))),
];
