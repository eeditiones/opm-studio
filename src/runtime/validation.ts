// ── page side of the schema worker ────────────────────────────────────────
import type { Possible } from './complete.ts';
import type { Problem } from './validate.ts';
import type { SchemaSource, ValidatorMessage, ValidatorRequest } from './validator.ts';

export type { Possible, Problem, SchemaSource };

type Reply = Extract<ValidatorMessage, { type: 'result' | 'possible' }>;
let worker: Worker | null = null;
let next = 0;
const pending = new Map<number, { key: string; resolve: (r: Reply) => void; reject: (e: Error) => void }>();
/** Keys the worker has the grammar for, so the schema crosses over once. */
const sent = new Set<string>();

function start(): Worker {
  const w = new Worker(new URL('validator.js', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<ValidatorMessage>) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (!p) return;
    if (data.type !== 'error') p.resolve(data);
    // a grammar that failed to load is dropped there, so send it again next time
    else { sent.delete(p.key); p.reject(new Error(data.message)); }
  };
  w.onerror = e => {
    worker = null; sent.clear(); w.terminate();
    for (const p of pending.values()) p.reject(new Error(e.message || 'The schema worker failed to start.'));
    pending.clear();
  };
  return w;
}

type Ask = { type: 'validate'; text: string } | { type: 'possible'; text: string; at: number };

/** Ask the worker about the grammar kept under key; schema loads it there the first time. */
function ask(key: string, schema: () => Promise<SchemaSource>, q: Ask): Promise<Reply> {
  return (sent.has(key) ? Promise.resolve(undefined) : schema()).then(source => new Promise<Reply>((resolve, reject) => {
    worker ??= start();
    const id = ++next;
    pending.set(id, { key, resolve, reject });
    const req: ValidatorRequest = { ...q, id, key, ...(source ? { schema: source } : {}) };
    worker.postMessage(req);
    if (source) sent.add(key);
  }));
}

/** Check text against the grammar under key. */
export const validateText = (key: string, schema: () => Promise<SchemaSource>, text: string): Promise<Problem[]> =>
  ask(key, schema, { type: 'validate', text }).then(r => (r.type === 'result' ? r.problems : []));

/** What the grammar under key allows at position at of text. */
export const possibleAt = (key: string, schema: () => Promise<SchemaSource>, text: string, at: number): Promise<Possible | null> =>
  ask(key, schema, { type: 'possible', text, at }).then(r => (r.type === 'possible' ? r.possible : null));
