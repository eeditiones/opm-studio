// App files are cached up front; the large CDN downloads (Pyodide, Python
// packages, marked, Paged.js, the Typst compiler) are cached the first time they are used.
const VERSION = 'v17';
const APP = `opm-app-${VERSION}`, CDN = 'opm-cdn';
// chunked output, put there by the page (src/ui/previews/site.ts) and served as if from a server
const PREVIEW = 'opm-preview', PREVIEW_PATH = new URL('preview/', self.registration.scope).pathname;
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'dist/app.js', 'dist/docworker.js', 'dist/open_processing_model-0.9.0-py3-none-any.whl'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'files.pythonhosted.org', 'pypi.org', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('opm-app-') && k !== APP).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin && url.pathname.startsWith(PREVIEW_PATH)) {
    // a link to a folder means its index.html, as a static file server would have it
    const key = url.pathname.endsWith('/') ? url.origin + url.pathname + 'index.html' : req;
    e.respondWith(caches.open(PREVIEW).then(c => c.match(key, { ignoreSearch: true }))
      .then(hit => hit || new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })));
  } else if (url.origin === location.origin) {
    // app files: try the network so edits show up, fall back to the cache offline
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    // versioned, immutable files: cache first
    e.respondWith(caches.open(CDN).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
});
