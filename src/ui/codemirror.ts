import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { keymap, lineNumbers, Decoration, ViewPlugin, MatchDecorator, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { xml, xmlLanguage } from '@codemirror/lang-xml';
import { linter, lintGutter, nextDiagnostic, type Diagnostic } from '@codemirror/lint';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { StreamLanguage } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { python } from '@codemirror/legacy-modes/mode/python';
import { json } from '@codemirror/legacy-modes/mode/javascript';
import { schemaCompletion } from './xmlCompletion.ts';
import { allowedElements, xmlCommands } from './xmlCommands.ts';
import type { Schema } from './xmlSchema.ts';

export const highlightStyle = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket, t.typeName, t.className, t.keyword], color: 'var(--tag)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--attr)' },
  { tag: [t.string, t.attributeValue, t.number, t.color, t.unit], color: 'var(--str)' },
  { tag: [t.comment, t.processingInstruction, t.meta], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.atom, t.bool, t.labelName], color: 'var(--accent)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--panel)', color: 'var(--fg)', fontSize: 'var(--editor-size, 12.5px)' },
  // --editor-* are set on the editor panel by ui/prefs.ts; elsewhere the defaults apply
  '.cm-scroller': { fontFamily: 'var(--editor-font, var(--mono))', lineHeight: 'calc(var(--editor-size, 12.5px) * 1.6)' },
  '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent) !important' },
  '.cm-jinja-expr': { color: 'var(--accent)' },
  '.cm-jinja-stmt': { color: 'var(--attr)', fontWeight: '600' },
  '.cm-jinja-comment': { color: 'var(--muted)', fontStyle: 'italic' },
  '.cm-tooltip.cm-tooltip-lint': { backgroundColor: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)' },
  '.cm-diagnostic': { fontFamily: 'var(--sans)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--err)' },
});

// Jinja2 tags are marked on top of whatever base language the template uses
const jinjaDeco = new MatchDecorator({
  regexp: /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g,
  decoration: m => Decoration.mark({ class: m[0][1] === '{' ? 'cm-jinja-expr' : m[0][1] === '%' ? 'cm-jinja-stmt' : 'cm-jinja-comment' }),
});
const jinja = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(v: EditorView) { this.decorations = jinjaDeco.createDeco(v); }
  update(u: ViewUpdate) { this.decorations = jinjaDeco.updateDeco(u, this.decorations); }
}, { decorations: p => p.decorations });

export type EditorKind = 'xml' | 'odd' | 'css' | 'html' | 'jinja' | 'toml' | 'python' | '';
const LANGS: Record<Exclude<EditorKind, ''>, () => Extension[]> = { xml: () => [xml()], odd: () => [xml()], css: () => [css()], html: () => [html(), jinja], jinja: () => [jinja], toml: () => [StreamLanguage.define(toml)], python: () => [StreamLanguage.define(python)] };

export interface Editor {
  getValue(): string;
  /** Show a new text, without reporting it as an edit and with an undo history of its own. */
  setValue(text: string, kind: EditorKind): void;
  /** Replace the text as an edit, touching only the span that differs so caret and scroll stay put. */
  replace(text: string): void;
  /** Check the XML against this schema after each pause in typing, and complete from it; null for none. */
  useSchema(schema: Schema | null): void;
  /** Select the next problem the check found, after the cursor. */
  nextProblem(): void;
  /** Put the cursor on a 1-based line and column, and bring it into view. */
  goTo(line: number, column?: number): void;
}

/** How the text shown stands against its schema: not checked, being checked, or the number of problems. */
export type Validity = null | 'checking' | number;

/** How long typing has to pause before the document is checked again. */
const VALIDATE_DELAY = 400;

const editors = new Set<EditorView>();
/** Have the editors measure their lines again, after a font or size change. */
export const remeasureEditors = (): void => editors.forEach(v => v.requestMeasure());

/** How the editors lay out text: spaces per indentation step, and whether long lines wrap. */
export interface Layout { tabSize: number; wrap: boolean }
let layout: Layout = { tabSize: 4, wrap: false };
const layoutConf = new Compartment();
const layoutExt = (l: Layout): Extension => [EditorState.tabSize.of(l.tabSize), indentUnit.of(' '.repeat(l.tabSize)), l.wrap ? EditorView.lineWrapping : []];
/** Lay out the text of all editors so, now and for each text shown later. */
export function setLayout(l: Layout): void {
  layout = l;
  editors.forEach(v => v.dispatch({ effects: layoutConf.reconfigure(layoutExt(l)) }));
}

export function createEditor(parent: HTMLElement, onChange: () => void, onValidity: (v: Validity) => void = () => {}): Editor {
  const lang = new Compartment(), schemaExt = new Compartment();
  /** A state of its own for each text shown, so undo never reaches back into the one before. */
  const stateFor = (text: string, kind: EditorKind) => EditorState.create({
    doc: text,
    extensions: [
      basicSetup, keymap.of([indentWithTab]), theme, syntaxHighlighting(highlightStyle),
      lang.of(kind ? LANGS[kind]() : []), schemaExt.of([]), layoutConf.of(layoutExt(layout)),
      kind === 'xml' || kind === 'odd' ? xmlCommands() : [],
      EditorView.updateListener.of(u => { if (u.docChanged) onChange(); }),
    ],
  });
  const view = new EditorView({ parent, state: stateFor('', '') });
  editors.add(view);
  return {
    getValue: () => view.state.doc.toString(),
    setValue(text, kind) {
      // setState reports no change, so this is not taken for an edit
      view.setState(stateFor(text, kind));
      view.scrollDOM.scrollTop = 0;
      onValidity(null);
    },
    useSchema(schema) {
      if (!schema) return;
      const check = async (v: EditorView): Promise<Diagnostic[]> => {
        const doc = v.state.doc, text = doc.toString();
        try {
          const found = (await schema.validate(text)).map(p => ({ from: Math.min(p.from, text.length), to: Math.min(p.to, text.length), severity: 'error' as const, message: p.message }));
          // the linter drops what arrives for a document that has changed since; so does the count
          if (view.state.doc === doc) onValidity(found.length);
          return found;
        } catch (e) {
          console.warn('Validation is off:', e);
          if (view.state.doc === doc) onValidity(null);
          return [];
        }
      };
      onValidity('checking');
      view.dispatch({ effects: schemaExt.reconfigure([
        linter(check, { delay: VALIDATE_DELAY }), lintGutter(),
        xmlLanguage.data.of({ autocomplete: schemaCompletion(schema) }),
        // between tags, what may be written is exactly the elements to surround with
        allowedElements.of(async (s, pos) => {
          const r = await schema.complete(s.doc.toString(), pos).catch(() => null);
          return r && !r.inTag ? r.suggestions.filter(x => x.kind === 'element').map(x => ({ name: x.label, detail: x.detail })) : null;
        }),
      ]) });
    },
    nextProblem() {
      view.focus();
      nextDiagnostic(view);
    },
    goTo(line, column = 1) {
      const doc = view.state.doc, l = doc.line(Math.min(Math.max(line, 1), doc.lines));
      const pos = l.from + Math.min(Math.max(column - 1, 0), l.length);
      view.focus();
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    },
    replace(text) {
      const old = view.state.doc.toString();
      let from = 0, end = old.length, tail = text.length;
      while (from < end && from < tail && old[from] === text[from]) from++;
      while (end > from && tail > from && old[end - 1] === text[tail - 1]) { end--; tail--; }
      if (from === end && from === tail) return;
      view.dispatch({ changes: { from, to: end, insert: text.slice(from, tail) } });
    },
  };
}

/** Read-only, highlighted view of generated output. */
export function createViewer(parent: HTMLElement, text: string, kind: EditorKind | 'json'): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorState.readOnly.of(true), EditorView.lineWrapping, lineNumbers(), theme, syntaxHighlighting(highlightStyle),
        kind === 'json' ? StreamLanguage.define(json) : kind ? LANGS[kind]() : [],
      ],
    }),
  });
}
