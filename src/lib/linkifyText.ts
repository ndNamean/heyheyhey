export type LinkifiedSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; raw: string };

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_SIMPLE = new Set(['.', ',', '!', '?', ';', ':']);
const MAX_PATH_DISPLAY = 40;

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Leave URLs inside pasted markup (e.g. `<a href="https://…">`) as plain text. */
function isEmbeddedInMarkup(text: string, start: number): boolean {
  const lt = text.lastIndexOf('<', start);
  if (lt === -1) return false;
  const gtBefore = text.lastIndexOf('>', start);
  if (gtBefore > lt) return false;
  return text.indexOf('>', start) !== -1;
}

/** Strip sentence punctuation and extra closing parens that are not part of the URL. */
export function trimTrailingUrlPunctuation(raw: string): string {
  let s = raw;
  while (s.length > 0) {
    const last = s[s.length - 1];
    if (TRAILING_SIMPLE.has(last)) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === ')') {
      let opens = 0;
      let closes = 0;
      for (const ch of s) {
        if (ch === '(') opens += 1;
        else if (ch === ')') closes += 1;
      }
      if (closes > opens) {
        s = s.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return s;
}

export function segmentLinkifiedText(text: string): LinkifiedSegment[] {
  if (!text) return [{ type: 'text', value: '' }];

  const segments: LinkifiedSegment[] = [];
  const re = new RegExp(URL_RE.source, URL_RE.flags);
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const trimmed = trimTrailingUrlPunctuation(match[0]);
    if (!trimmed || !isSafeHttpUrl(trimmed) || isEmbeddedInMarkup(text, start)) {
      continue;
    }

    if (start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, start) });
    }
    segments.push({ type: 'link', href: trimmed, raw: trimmed });
    cursor = start + trimmed.length;
    re.lastIndex = cursor;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }

  return segments.length ? segments : [{ type: 'text', value: text }];
}

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, '');
}

function decodePath(pathname: string): string {
  if (!pathname || pathname === '/') return '';
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export function displayUrlParts(href: string): { hostname: string; path: string } {
  try {
    const parsed = new URL(href);
    const hostname = stripWww(parsed.hostname) || stripWww(parsed.host) || parsed.hostname;
    let path = decodePath(parsed.pathname);
    const hasExtra = Boolean(parsed.search || parsed.hash);
    if (path.length > MAX_PATH_DISPLAY) {
      path = `${path.slice(0, MAX_PATH_DISPLAY - 1)}…`;
    } else if (hasExtra && path) {
      path = `${path}…`;
    } else if (hasExtra && !path) {
      path = '…';
    }
    return { hostname, path };
  } catch {
    return { hostname: href, path: '' };
  }
}

/** Visual-only label: hostname (no www) + truncated path. Never hides hostname. */
export function displayUrlLabel(href: string): string {
  const { hostname, path } = displayUrlParts(href);
  return path ? `${hostname}${path}` : hostname;
}

/** True when the trimmed line is exactly one http(s) URL (Mode B). */
export function isStandaloneUrlLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const segs = segmentLinkifiedText(trimmed);
  return segs.length === 1 && segs[0].type === 'link' && segs[0].raw === trimmed;
}
