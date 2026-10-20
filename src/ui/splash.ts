// The splash covers the app until Python, opm and the last project are loaded.
import type { DownloadProgress } from '../runtime/download.ts';
import { $ } from './dom.ts';

function mb(n: number): string {
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

export function splash(step: string, pct: number, download?: DownloadProgress): void {
  $('splash-step').textContent = step;
  $('splash-fill').style.width = Math.min(100, Math.max(0, pct)) + '%';
  // only touch the size line when the runtime reports bytes, so later steps keep the total
  if (download === undefined) return;
  const size = $('splash-size');
  if (download.loaded <= 0) {
    size.hidden = true;
    size.textContent = '';
    return;
  }
  size.hidden = false;
  size.textContent = download.total > 0
    ? mb(download.loaded) + ' / ' + mb(download.total)
    : mb(download.loaded) + ' downloaded';
}

export function hideSplash(): void {
  const s = $('splash');
  s.classList.add('done');
  setTimeout(() => s.remove(), 300);
}

/** Keep the splash up with the error, rather than leave a half-working page. */
export function splashFailed(err: unknown): void {
  $('splash').classList.add('failed');
  splash('Could not start: ' + ((err as Error)?.message || err) + '. Reload to try again.', 100);
}
