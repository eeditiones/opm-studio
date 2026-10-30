import { LitElement, html } from "lit";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { css } from "@codemirror/lang-css";
import { xQuery } from "@codemirror/legacy-modes/mode/xquery";
import {
  syntaxHighlighting,
  bracketMatching,
  StreamLanguage,
} from "@codemirror/language";
import { highlightStyle } from "../codemirror.ts";
import { XML_COMMANDS, xmlCommands } from "../xmlCommands.ts";

/** Highlighting and commands for a field's language. */
function languageSupport(language: CmField["language"]): Extension {
  switch (language) {
    case "xml":
      return [xml(), xmlCommands()];
    case "css":
      return css();
    case "xquery":
      return StreamLanguage.define(xQuery);
    default:
      return [];
  }
}

/** Form fields look like the app's inputs and share the editor's syntax colours. */
const fieldTheme = EditorView.theme({
  "&": {
    color: "var(--fg)",
    backgroundColor: "var(--panel)",
    border: "1px solid var(--btn-line)",
    borderRadius: "6px",
    fontSize: "var(--odd-size, 12.5px)",
  },
  ".cm-content": { fontFamily: "var(--editor-font, var(--mono))", caretColor: "var(--fg)", padding: "5px 0" },
  ".cm-line": { padding: "0 8px" },
  "&.cm-focused": { outline: "none", borderColor: "var(--accent)" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 40%, transparent) !important",
  },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--faint)", border: "none" },
});

/**
 * A single-value CodeMirror field as a custom element. Set `value` and
 * `language` ("xml" | "css" | "xquery" | "text"); emits a `cm-change` event
 * (detail = string) on every edit. Used for predicate (XPath-ish), template,
 * rendition-CSS and parameter-value (XQuery) fields.
 */
export class CmField extends LitElement {
  static properties = {
    value: {},
    language: {},
  };
  declare value: string;
  declare language: "xml" | "css" | "xquery" | "text";
  private view?: EditorView;
  private languageConf = new Compartment();
  /** Suppress cm-change while syncing the document from the value property. */
  private syncing = false;

  constructor() {
    super();
    this.value = "";
    this.language = "text";
  }

  render() {
    return html`<div class="cm-host"></div>`;
  }

  firstUpdated() {
    const host = this.renderRoot.querySelector(".cm-host") as HTMLElement;
    const extensions = [
      history(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      syntaxHighlighting(highlightStyle, { fallback: true }),
      bracketMatching(),
      EditorView.lineWrapping,
      fieldTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !this.syncing) {
          this.value = u.state.doc.toString();
          this.dispatchEvent(
            new CustomEvent("cm-change", {
              detail: this.value,
              bubbles: true,
              composed: true,
            })
          );
        }
      }),
      this.languageConf.of(languageSupport(this.language)),
    ];
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: this.value ?? "", extensions }),
    });
  }

  updated(changed: Map<string, unknown>) {
    // A rule's output can change from an XML format to a plain-text one
    if (changed.has("language") && changed.get("language") !== undefined && this.view) {
      this.view.dispatch({
        effects: this.languageConf.reconfigure(languageSupport(this.language)),
      });
    }
    if (changed.has("value") && this.view) {
      const current = this.view.state.doc.toString();
      // The ODD is re-read after each save and parsed values are trimmed; don't
      // wipe a trailing newline or space the user is in the middle of typing.
      const typing =
        this.view.hasFocus && current.trim() === (this.value ?? "").trim();
      if (!typing && current !== (this.value ?? "")) {
        this.syncing = true;
        try {
          this.view.dispatch({
            changes: { from: 0, to: current.length, insert: this.value ?? "" },
          });
        } finally {
          this.syncing = false;
        }
      }
    }
  }

  /** Insert text at the current cursor (used by the template toolbar). */
  insert(text: string) {
    if (!this.view) {
      return;
    }
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    this.view.focus();
  }

  /** Run one of the XML commands (used by the template toolbar). */
  run(command: keyof typeof XML_COMMANDS) {
    if (this.view) {
      // focus first: surrounding moves it on to the prompt for the name
      this.view.focus();
      XML_COMMANDS[command].run(this.view);
    }
  }
}

customElements.define("cm-field", CmField);
