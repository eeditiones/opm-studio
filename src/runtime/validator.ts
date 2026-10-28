// ── validation worker: salve checks XML against RELAX NG off the page's thread ─
// Turning a large RNG into a grammar takes the better part of a second, and a
// pass over a long document up to a tenth; on the page either would stall typing.
import { convertRNGToPattern, readTreeFromJSON, type Grammar, type Resource } from 'salve-annos';
import { validate, type Problem } from './validate.ts';

/** A grammar to keep under `key`: the shipped JSON, or a project RNG with every RNG it may include. */
export type SchemaSource = { json: string } | { main: string; files: Record<string, string> };
export type ValidatorRequest =
  | { type: 'validate'; id: number; key: string; schema?: SchemaSource; text: string };
export type ValidatorMessage =
  | { type: 'result'; id: number; problems: Problem[] }
  | { type: 'error'; id: number; message: string };

const BASE = 'file:///project/';
const grammars = new Map<string, Promise<Grammar>>();
const post = (m: ValidatorMessage) => (self as unknown as Worker).postMessage(m);

/** Project files by URL, so include and externalRef resolve as they would on disk. */
function loader(files: Record<string, string>) {
  return {
    async load(url: URL): Promise<Resource> {
      const path = decodeURIComponent(url.href.startsWith(BASE) ? url.href.slice(BASE.length) : url.pathname);
      const text = files[path];
      if (text === undefined) throw new Error(`${path} is not in the project`);
      return { url, getText: async () => text };
    },
  };
}

function grammarOf(source: SchemaSource): Promise<Grammar> {
  if ('json' in source) return Promise.resolve(readTreeFromJSON(JSON.parse(source.json)));
  return convertRNGToPattern(new URL(source.main, BASE), { resourceLoader: loader(source.files) } as Parameters<typeof convertRNGToPattern>[1])
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
    post({ type: 'result', id: data.id, problems: validate(await g, data.text) });
  } catch (err) {
    post({ type: 'error', id: data.id, message: err instanceof Error ? err.message : String(err) });
  }
};
