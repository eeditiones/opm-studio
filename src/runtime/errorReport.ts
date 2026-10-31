// ── an error from the transform as something to read: what, where, and the raw trace ──
export interface ErrorReport {
  title: string;
  message: string;
  /** The project file at fault, relative to the project, with its 1-based line and column when known. */
  file?: string;
  line?: number;
  column?: number;
  /** The Python traceback, or '' when there is none. */
  trace: string;
}

export interface ExcerptLine { n: number; text: string; hit: boolean }

const TITLES: Record<string, string> = {
  XMLSyntaxError: 'The XML is not well-formed',
  TemplateSyntaxError: 'The template has a syntax error',
  TemplateNotFound: 'A template could not be found',
  UndefinedError: 'The template uses something undefined',
  FileNotFoundError: 'A file could not be found',
};

/** Read an error's text. `dir` is the project folder; `fallback` titles errors without one of their own. */
export function reportError(text: string, dir: string, fallback = 'Something went wrong'): ErrorReport {
  const shorten = (s: string) => dir ? s.split(dir + '/').join('') : s;
  const at = text.indexOf('Traceback (most recent call last):');
  if (at < 0) return { title: fallback, message: shorten(text.replace(/^\w*Error:\s*/, '').trim()), trace: '' };

  const trace = text.slice(at).trim(), lines = trace.split('\n');
  // what the exception says comes after the last frame, whose own lines are indented
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0 && !/^\s+File "/.test(lines[i]); i--) if (!/^\s/.test(lines[i])) end = i;
  const said = lines.slice(end).join('\n').trim();
  const split = said.match(/^([A-Za-z_][\w.]*)(?::\s*([\s\S]*))?$/);
  const type = split?.[1].split('.').pop() ?? '';
  let message = split ? split[2] ?? '' : said;

  // the innermost frame inside the project is the file to look at
  const frames = [...trace.matchAll(/^\s*File "([^"]+)", line (\d+)/gm)].filter(m => m[1].startsWith(dir + '/'));
  const frame = dir ? frames.pop() : undefined;
  // lxml also spells the place out in its message
  const place = message.match(/,? line (\d+), column (\d+)(?: \([^)]*\))?\s*$/);
  if (place) message = message.slice(0, place.index);
  const line = frame && +frame[2];

  return {
    title: TITLES[type] ?? fallback,
    message: shorten(message.trim()) || type,
    trace: shorten(trace),
    ...(frame && {
      file: frame[1].slice(dir.length + 1), line,
      ...(place && +place[1] === line && { column: +place[2] }),
    }),
  };
}

const CONTEXT = 2, WIDTH = 160;

/** The lines around the one at fault; a very long line is cut down to the part around the column. */
export function excerpt(text: string, line: number, column = 1): ExcerptLine[] {
  const lines = text.split('\n');
  if (line < 1 || line > lines.length) return [];
  const start = Math.max(0, column - WIDTH / 2);
  const out: ExcerptLine[] = [];
  for (let n = Math.max(1, line - CONTEXT); n <= Math.min(lines.length, line + CONTEXT); n++) {
    const raw = lines[n - 1].trimEnd();
    const cut = raw.slice(start, start + WIDTH);
    out.push({ n, hit: n === line, text: (start > 0 && cut ? '…' : '') + cut + (raw.length > start + WIDTH ? '…' : '') });
  }
  return out;
}
