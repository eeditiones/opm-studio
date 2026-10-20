import { IMAGES } from '../config.ts';
import { extOf } from '../project/fs.ts';

const ICON: Record<string, string> = { xml: 'XML', odd: 'ODD', tei: 'XML', css: 'CSS', j2: 'J2', toml: 'TOML', py: 'PY', md: 'MD', json: 'JSON', svg: 'SVG' };

/** The short type tag shown before a file name in tabs and the tree. */
export const icon = (p: string) => IMAGES.has(extOf(p)) ? 'IMG' : ICON[extOf(p)] || '·';

export const ENLARGE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9"/></svg>';
export const SHRINK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M13.5 6.5h-4v-4M9.5 6.5L14 2M2.5 9.5h4v4M6.5 9.5L2 14"/></svg>';
export const DOWNLOAD = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M2.5 14h11"/></svg>';
export const PRINT = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6V2.5h8V6M4 12H3a1.5 1.5 0 0 1-1.5-1.5v-4A1.5 1.5 0 0 1 3 5h10a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 13 12h-1M4 9.5h8V14H4z"/></svg>';
