export const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
export const WHEEL = 'open_processing_model-0.10.0-py3-none-any.whl';
export const MARKED = 'https://cdn.jsdelivr.net/npm/marked@15/lib/marked.esm.js';
export const MARKED_FOOTNOTE = 'https://cdn.jsdelivr.net/npm/marked-footnote@1/dist/index.js';
export const PAGEDJS = 'https://cdn.jsdelivr.net/npm/pagedjs@0.4.3/dist/paged.polyfill.min.js';
export const TYPST = 'https://cdn.jsdelivr.net/npm/@myriaddreamin/';

export const MODES = ['web', 'print', 'epub', 'markdown', 'docx', 'typst', 'json', 'chunk'] as const;
export type Mode = typeof MODES[number];
export const isMode = (m: unknown): m is Mode => MODES.includes(m as Mode);

/** File extension of each mode's output. */
export const EXT: Record<Mode, string> = { web: 'html', print: 'html', epub: 'epub', markdown: 'md', docx: 'docx', typst: 'typ', json: 'json', chunk: 'zip' };
/** Modes with a rendered view beside the code view. */
export const PREVIEW = new Set<Mode>(['web', 'print', 'markdown', 'typst']);
/** Modes that take a template, and which kind. */
export const TEMPLATE_KIND: Partial<Record<Mode, 'html' | 'typ'>> = { web: 'html', print: 'html', typst: 'typ' };

/** Never listed in the explorer. */
export const HIDDEN = new Set(['chunks', '__pycache__', '.git', '.DS_Store', 'node_modules']);
export const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp']);
