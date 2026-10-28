// ── schema worker: salve validates XML and completes it, off the page's thread ─
// Turning a large RNG into a grammar takes the better part of a second, and a
// pass over a long document up to a tenth; on the page either would stall typing.
import { convertRNGToPattern, type Grammar, type Resource } from 'salve-annos';
import { possibleAt, type Possible } from './complete.ts';
import { validate, type Problem } from './validate.ts';

/** A grammar to keep under `key`: an RNG on the site (the defaults), or a project RNG with every RNG it may include. */
export type SchemaSource = { url: string } | { main: string; files: Record<string, string> };
export type ValidatorRequest =
  | { type: 'validate'; id: number; key: string; schema?: SchemaSource; text: string }
  | { type: 'possible'; id: number; key: string; schema?: SchemaSource; text: string; at: number };
export type ValidatorMessage =
  | { type: 'result'; id: number; problems: Problem[] }
  | { type: 'possible'; id: number; possible: Possible | null }
  | { type: 'error'; id: number; message: string };

const BASE = 'file:///project/';
const grammars = new Map<string, Promise<Grammar>>();
const post = (m: ValidatorMessage) => (self as unknown as Worker).postMessage(m);

/** Project files by their path; anything else, the site's schemas and what they include, fetched. */
function loader(files: Record<string, string>) {
  return {
    async load(url: URL): Promise<Resource> {
      if (url.href.startsWith(BASE)) {
        const path = decodeURIComponent(url.href.slice(BASE.length)), text = files[path];
        if (text === undefined) throw new Error(`${path} is not in the project`);
        return { url, getText: async () => text };
      }
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} could not be loaded: ${r.status}`);
      const text = await r.text();
      return { url, getText: async () => text };
    },
  };
}

function grammarOf(source: SchemaSource): Promise<Grammar> {
  const [main, files] = 'url' in source ? [new URL(source.url), {}] : [new URL(source.main, BASE), source.files];
  // the options type wants every field; salve fills in the others
  return convertRNGToPattern(main, { resourceLoader: loader(files) } as Parameters<typeof convertRNGToPattern>[1])
    .then(r => r.pattern);
}

self.onmessage = async ({ data }: MessageEvent<ValidatorRequest>) => {
  try {
    let g = grammars.get(data.key);
    if (!g && data.schema) {
      g = grammarOf(data.schema);
      g.catch(() => grammars.delete(data.key));
      grammars.set(data.key, g);
    }
    if (!g) throw new Error(`no schema for ${data.key}`);
    const grammar = await g;
    if (data.type === 'validate') post({ type: 'result', id: data.id, problems: validate(grammar, data.text) });
    else post({ type: 'possible', id: data.id, possible: possibleAt(grammar, data.text, data.at) });
  } catch (err) {
    post({ type: 'error', id: data.id, message: err instanceof Error ? err.message : String(err) });
  }
};
