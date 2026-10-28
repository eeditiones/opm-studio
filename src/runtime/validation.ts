// ── page side of the validation worker ───────────────────────────────────
import type { Problem } from './validate.ts';
import type { SchemaSource, ValidatorMessage, ValidatorRequest } from './validator.ts';

export type { Problem, SchemaSource };

let worker: Worker | null = null;
let next = 0;
const pending = new Map<number, { key: string; resolve: (p: Problem[]) => void; reject: (e: Error) => void }>();
/** Keys the worker has the grammar for, so the schema crosses over once. */
const sent = new Set<string>();

function start(): Worker {
  const w = new Worker(new URL('validator.js', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<ValidatorMessage>) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (!p) return;
    if (data.type === 'result') p.resolve(data.problems);
    // a grammar that failed to load is dropped there, so send it again next time
    else { sent.delete(p.key); p.reject(new Error(data.message)); }
  };
  w.onerror = e => {
    worker = null; sent.clear(); w.terminate();
    for (const p of pending.values()) p.reject(new Error(e.message || 'The validation worker failed to start.'));
    pending.clear();
  };
  return w;
}

/** Check text against the grammar kept under key; schema loads it there the first time. */
export function validateText(key: string, schema: () => Promise<SchemaSource>, text: string): Promise<Problem[]> {
  return (sent.has(key) ? Promise.resolve(undefined) : schema()).then(source => new Promise<Problem[]>((resolve, reject) => {
    worker ??= start();
    const id = ++next;
    pending.set(id, { key, resolve, reject });
    const req: ValidatorRequest = { type: 'validate', id, key, text, ...(source ? { schema: source } : {}) };
    worker.postMessage(req);
    if (source) sent.add(key);
  }));
}
