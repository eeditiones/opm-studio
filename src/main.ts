// ── boot: wire the panes, load Python and opm, reopen the last project ────
import { lastProject } from './actions.ts';
import { initAutosave } from './project/autosave.ts';
import { initSync } from './project/sync.ts';
import { getProject } from './project/store.ts';
import { loadRuntime } from './runtime/pyodide.ts';
import { initEditor } from './ui/editor.ts';
import { initExplorer } from './ui/explorer.ts';
import { initLayout } from './ui/layout.ts';
import { initOutput } from './ui/output.ts';
import { initPrefs } from './ui/prefs.ts';
import { loadMarked } from './ui/previews/markdown.ts';
import { hideSplash, splash, splashFailed } from './ui/splash.ts';
import { initStart, openSaved, renderCards, showStart } from './ui/start.ts';
import { setStatus } from './ui/status.ts';
import { initSwitcher } from './ui/switcher.ts';
import { initSyncUi } from './ui/sync.ts';
import { initTheme } from './ui/theme.ts';
import { initTips } from './ui/tip.ts';
import { initUploads } from './ui/uploads.ts';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

initLayout();
initEditor();
initExplorer();
initOutput();
initTips();
initUploads();
initStart();
initSwitcher();
initTheme();
initPrefs();
initAutosave();
initSync();
initSyncUi();

try {
  await loadRuntime(splash);
  void loadMarked().catch(() => {}); // a failure shows up when Markdown is previewed
  renderCards();
  setStatus('Ready');
  const last = lastProject();
  if (last && await getProject(last)) {
    splash('Opening ' + last + '…', 90);
    await openSaved(last);
  } else showStart(true);
  splash('Ready', 100);
  hideSplash();
} catch (err) {
  splashFailed(err);
  throw err;
}
