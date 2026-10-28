import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { keymap, lineNumbers, Decoration, ViewPlugin, MatchDecorator, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { xml, xmlLanguage } from '@codemirror/lang-xml';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { StreamLanguage } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { python } from '@codemirror/legacy-modes/mode/python';
import { json } from '@codemirror/legacy-modes/mode/javascript';
import { schemaCompletion } from './xmlCompletion.ts';
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
  /** Replace the text without reporting it as an edit. */
  setValue(text: string, kind: EditorKind): void;
  /** Replace the text as an edit, touching only the span that differs so caret and scroll stay put. */
  replace(text: string): void;
  /** Check the XML against this schema after each pause in typing, and complete from it; null for none. */
  useSchema(schema: Schema | null): void;
}

/** How long typing has to pause before the document is checked again. */
const VALIDATE_DELAY = 400;

const editors = new Set<EditorView>();
/** Have the editors measure their lines again, after a font or size change. */
export const remeasureEditors = (): void => editors.forEach(v => v.requestMeasure());

export function createEditor(parent: HTMLElement, onChange: () => void): Editor {
  const lang = new Compartment(), schemaExt = new Compartment();
  let silent = false, shown = 0;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup, keymap.of([indentWithTab]), theme, syntaxHighlighting(highlightStyle), lang.of([]), schemaExt.of([]),
        EditorView.updateListener.of(u => { if (u.docChanged && !silent) onChange(); }),
      ],
    }),
  });
  editors.add(view);
  return {
    getValue: () => view.state.doc.toString(),
    setValue(text, kind) {
      silent = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: [lang.reconfigure(kind ? LANGS[kind]() : []), schemaExt.reconfigure([])],
        selection: { anchor: 0 }, scrollIntoView: true });
      silent = false;
      shown++;
    },
    useSchema(schema) {
      if (!schema) return;
      const check = async (v: EditorView): Promise<Diagnostic[]> => {
        const text = v.state.doc.toString();
        try {
          // the linter drops what arrives for a document that has changed since
          return (await schema.validate(text)).map(p => ({ from: Math.min(p.from, text.length), to: Math.min(p.to, text.length), severity: 'error', message: p.message }));
        } catch (e) {
          console.warn('Validation is off:', e);
          return [];
        }
      };
      view.dispatch({ effects: schemaExt.reconfigure([
        linter(check, { delay: VALIDATE_DELAY }), lintGutter(),
        xmlLanguage.data.of({ autocomplete: schemaCompletion(schema) }),
      ]) });
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
