export type DownloadProgress = { loaded: number; total: number };

/** Watch `fetch` during `fn` and report how many bytes have arrived. */
export async function withDownloadProgress<T>(
  onProgress: (loaded: number, total: number) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const orig = globalThis.fetch;
  let loaded = 0;
  /** Sum of Content-Length headers when the server sends them. */
  let announced = 0;
  let pending = false;

  const notify = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      // total is 0 until at least one response reports Content-Length
      onProgress(loaded, announced > 0 ? Math.max(announced, loaded) : 0);
    });
  };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await orig(input, init);
    if (!res.body) return res;

    const len = Number(res.headers.get('Content-Length'));
    const hasLen = Number.isFinite(len) && len > 0;
    if (hasLen) announced += len;

    let got = 0;
    const stream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        got += chunk.byteLength;
        loaded += chunk.byteLength;
        // Content-Length is often the compressed size; the body is larger once decoded
        if (hasLen && got > len) announced += Math.min(chunk.byteLength, got - len);
        notify();
        ctrl.enqueue(chunk);
      },
    });

    return new Response(res.body.pipeThrough(stream), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  };

  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
    onProgress(loaded, announced > 0 ? Math.max(announced, loaded) : 0);
  }
}
