// Print HTML → on-screen pages via Paged.js (CSS Paged Media polyfill).
// The script is injected into the preview document only; downloads stay plain HTML.
import { PAGEDJS } from '../../config.ts';

/**
 * Page-sheet chrome. Applied in PagedConfig.after — not as a static <style> in
 * the document — because Paged.js rebuilds the DOM and drops @media screen
 * rules while polishing, so a head/body stylesheet never sticks.
 */
const PREVIEW_CSS = /* css */ `
:root {
  --opm-paged-bg: #efece4;
  --opm-paged-paper: #fff;
  --opm-paged-shadow: 0 1px 2px rgba(31, 29, 26, .10), 0 4px 10px rgba(31, 29, 26, .08), 0 12px 28px rgba(31, 29, 26, .10);
}
html, body {
  margin: 0 !important;
  max-width: none !important;
  padding: 0 !important;
  background: var(--opm-paged-bg) !important;
}
.pagedjs_pages {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  width: 100% !important;
  margin: 0 auto !important;
}
.pagedjs_page {
  background: var(--opm-paged-paper) !important;
  box-shadow: var(--opm-paged-shadow) !important;
  border-radius: 2px;
  margin: 12mm 0 0 !important;
  flex-shrink: 0 !important;
  flex-grow: 0 !important;
}
.pagedjs_page:first-of-type { margin-top: 12mm !important; }
.pagedjs_page:last-of-type { margin-bottom: 12mm !important; }
.pagedjs_first_page { margin-left: 0 !important; }
`;

/** Message the preview frame posts to the app when pagination ends. */
export interface PagedMessage { opmPaged: 'done' | 'error'; pages?: number }

/** Inline boot: set PagedConfig, then load the polyfill. */
const BOOT = /* js */ `
window.PagedConfig = {
  auto: true,
  after: function (flow) {
    if (!document.getElementById('opm-paged-preview')) {
      var s = document.createElement('style');
      s.id = 'opm-paged-preview';
      s.textContent = ${JSON.stringify(PREVIEW_CSS)};
      document.head.appendChild(s);
    }
    parent.postMessage({ opmPaged: 'done', pages: flow && flow.total }, '*');
  }
};
`;

const INJECT = [
  `<script>${BOOT}</script>`,
  `<script src="${PAGEDJS}" onerror="parent.postMessage({ opmPaged: 'error' }, '*')"></script>`,
].join('');

/** Warm the CDN (and service-worker) cache so the first print preview is quicker. */
export function prefetchPaged(): void {
  void fetch(PAGEDJS, { mode: 'cors' }).catch(() => {});
}

/**
 * Ensure the print HTML loads Paged.js so @page rules become visible page boxes.
 * Idempotent if the document already includes the polyfill.
 */
export function withPagedJs(html: string): string {
  if (/paged\.polyfill|PagedConfig/i.test(html)) return html;
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, INJECT + '</body>');
  if (/<\/html\s*>/i.test(html)) return html.replace(/<\/html\s*>/i, INJECT + '</html>');
  return html + INJECT;
}
