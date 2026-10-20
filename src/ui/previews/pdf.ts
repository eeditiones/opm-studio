// Typst source → PDF in the browser. The compiler (≈9 MB compressed) is only
// fetched the first time a PDF is shown.
import { TYPST } from '../../config.ts';

interface TypstSnippet {
  setCompilerInitOptions(opts: { getModule: () => string }): void;
  pdf(opts: { mainContent: string }): Promise<Uint8Array>;
}
// The all-in-one bundle installs itself as a global rather than exporting.
declare const $typst: TypstSnippet;

let typstReady: Promise<TypstSnippet> | null = null;
let compiled = false;

function loadTypst(): Promise<TypstSnippet> {
  typstReady ??= import(TYPST + 'typst.ts@0.7.0/dist/esm/contrib/all-in-one-lite.bundle.js').then(() => {
    $typst.setCompilerInitOptions({ getModule: () => TYPST + 'typst-ts-web-compiler@0.7.0/pkg/typst_ts_web_compiler_bg.wasm' });
    return $typst;
  }).catch(e => { typstReady = null; throw e; });
  return typstReady;
}

/** Whether a PDF has been compiled in this session, i.e. the compiler is no longer downloaded first. */
export const typstLoaded = () => compiled;

export async function compilePdf(source: string): Promise<Uint8Array> {
  const pdf = await (await loadTypst()).pdf({ mainContent: source });
  compiled = true;
  return pdf;
}
