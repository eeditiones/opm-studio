import { LitElement, html, nothing, type TemplateResult } from "lit";
import { type ElementSpec, type ModelType, MODES } from "../../odd/oddTypes.ts";
import { ModelCard, emptyModel } from "./model-card.ts";
import { ModelOpenState } from "./model-open-state.ts";
import { onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } from "./dnd.ts";
import {
  copyElementSpec,
  pasteModel,
  hasModelClip,
  onClipChange,
} from "./clipboard.ts";
import { validateXmlFragment } from "../../odd/templateValidation.ts";
import "./codemirror.ts";
import "./model-card.ts";
import { COPY, PASTE, TRASH } from "./icons.ts";

void ModelCard;

/** An `<elementSpec>` accepts all three rule types directly. */
const SPEC_RULE_TYPES: ModelType[] = ["model", "modelGrp", "modelSequence"];

/**
 * The main panel: one selected elementSpec — its ident, mode, description, a
 * toolbar, and the list of top-level model cards. Owns the spec's top-level
 * `models` array for add / move / remove / duplicate; persistence flows up via
 * `odd-change`.
 */
export class ElementSpecPanel extends LitElement {
  static properties = {
    spec: { attribute: false },
    specIndex: { type: Number },
    modelOpenState: { attribute: false },
    onDelete: { attribute: false },
    channel: { attribute: false },
  };
  declare spec: ElementSpec;
  declare specIndex: number;
  declare modelOpenState: ModelOpenState;
  declare onDelete?: () => void;
  /** Output mode of the preview, to mark the rule that fires for it. */
  declare channel?: string;

  private unsubClip?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.unsubClip = onClipChange(() => this.requestUpdate());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubClip?.();
  }

  private changed() {
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent("odd-change", { bubbles: true, composed: true })
    );
  }

  /**
   * The element's own `<desc>`. Edited as markup rather than plain text: a
   * `<desc>` may carry phrase-level markup such as `<gi>` and `<ref>`, and
   * flattening it would quietly drop that on the next save.
   */
  private descField(spec: ElementSpec): TemplateResult {
    const error = validateXmlFragment(spec.desc ?? "");
    return html`
      <div class="field spec-desc ${error ? "invalid" : ""}">
        <span>Description</span>
        <cm-field
          language="xml"
          .value=${spec.desc ?? ""}
          @cm-change=${(e: CustomEvent<string>) => {
            spec.desc = e.detail || undefined;
            this.changed();
          }}
        ></cm-field>
        ${error
          ? html`<div class="field-error" role="alert">${error}</div>`
          : nothing}
      </div>
    `;
  }

  render(): TemplateResult {
    const spec = this.spec;
    if (!spec) {
      return html`<div class="empty-main">Select an element on the left.</div>`;
    }
    const addModel = (type: ModelType) => {
      spec.models.unshift(emptyModel(type));
      this.changed();
    };
    // Rules are tried in order; the first one without a predicate catches the rest
    const ch = this.channel;
    const forChannel = (m: { output?: string }) => !ch || !m.output || m.output === ch || m.output === "opm-" + ch;
    const fallback = ch ? spec.models.findIndex((m) => forChannel(m) && !m.predicate) : -1;
    return html`
      <div class="spec-head">
        <input
          class="ident"
          type="text"
          .value=${spec.ident}
          @input=${(e: Event) => {
            spec.ident = (e.target as HTMLInputElement).value;
            this.dispatchEvent(
              new CustomEvent("spec-ident-change", { bubbles: true, composed: true })
            );
            this.changed();
          }}
        />
        <label class="mode">
          MODE:
          <select
            @change=${(e: Event) => {
              spec.mode = (e.target as HTMLSelectElement).value || undefined;
              this.changed();
            }}
          >
            <option value="" ?selected=${!spec.mode}>(none)</option>
            ${MODES.map(
              (m) => html`<option value=${m} ?selected=${spec.mode === m}>${m}</option>`
            )}
          </select>
        </label>
        <span class="spacer"></span>
        <div class="spec-actions">
          <button data-tip="Add model" @click=${() => addModel("model")}>+ model</button>
          <button data-tip="Add modelSequence" @click=${() => addModel("modelSequence")}>+ sequence</button>
          <button data-tip="Add modelGrp" @click=${() => addModel("modelGrp")}>+ group</button>
          <button
            class="icon"
            aria-label="Copy elementSpec"
            @click=${() => copyElementSpec(spec)}
          >${COPY}</button>
          ${hasModelClip()
            ? html`<button
                class="icon"
                aria-label="Paste model"
                @click=${() => {
                  const c = pasteModel();
                  if (c) {
                    spec.models.unshift(c);
                    this.changed();
                  }
                }}
              >${PASTE}</button>`
            : nothing}
          <button class="icon danger" aria-label="Delete element" @click=${() => this.onDelete?.()}>${TRASH}</button>
        </div>
      </div>

      ${spec.hasUnmodeled
        ? html`<div class="warn">
            A rule below contains markup the form doesn't edit. It survives as
            long as you leave that rule alone — editing one of its fields
            rebuilds the rule from the fields shown here, and drops the rest.
          </div>`
        : nothing}

      ${spec.otherChildren?.length
        ? html`<div class="note">
            Also defines
            ${spec.otherChildren.map((name) => html`<code>${name}</code> `)} —
            not editable here, kept as-is when you save.
          </div>`
        : nothing}

      ${this.descField(spec)}

      <div class="models">
        ${spec.models.length === 0
          ? html`<div class="empty-models">No models yet — add one above.</div>`
          : spec.models.map(
              (m, i) => html`
                <model-card
                  .model=${m}
                  .index=${i}
                  .count=${spec.models.length}
                  .specIndex=${this.specIndex}
                  .path=${[i]}
                  .modelOpenState=${this.modelOpenState}
                  .siblingTypes=${SPEC_RULE_TYPES}
                  .fires=${i === fallback}
                  .elsewhere=${!forChannel(m)}
                  @dragstart=${(e: DragEvent) => onDragStart(e, spec.models, i)}
                  @dragover=${(e: DragEvent) => onDragOver(e, spec.models, i)}
                  @dragleave=${(e: DragEvent) => onDragLeave(e)}
                  @drop=${(e: DragEvent) => {
                    if (onDrop(e, spec.models)) this.changed();
                  }}
                  @dragend=${() => onDragEnd()}
                  .onRemove=${(idx: number) => {
                    spec.models.splice(idx, 1);
                    this.changed();
                  }}
                  .onPaste=${(idx: number) => {
                    const c = pasteModel();
                    if (c) {
                      spec.models.splice(idx + 1, 0, c);
                      this.changed();
                    }
                  }}
                ></model-card>
              `
            )}
      </div>
    `;
  }
}

customElements.define("elementspec-panel", ElementSpecPanel);
