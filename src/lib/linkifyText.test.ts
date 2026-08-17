import { describe, expect, it } from 'vitest';
import {
  displayUrlLabel,
  displayUrlParts,
  isStandaloneUrlLine,
  segmentLinkifiedText,
  trimTrailingUrlPunctuation,
  type LinkifiedSegment,
} from './linkifyText';

function joined(segs: LinkifiedSegment[]): string {
  return segs.map((s) => (s.type === 'link' ? s.raw : s.value)).join('');
}

describe('segmentLinkifiedText', () => {
  it('round-trips original characters including newlines', () => {
    const input = 'Keep\nthis  exactly.\n';
    expect(joined(segmentLinkifiedText(input))).toBe(input);
  });

  it('detects one HTTP URL', () => {
    const segs = segmentLinkifiedText('See http://example.com/docs');
    expect(segs).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', href: 'http://example.com/docs', raw: 'http://example.com/docs' },
    ]);
  });

  it('detects one HTTPS URL', () => {
    const segs = segmentLinkifiedText('https://example.com/manual');
    expect(segs).toEqual([
      { type: 'link', href: 'https://example.com/manual', raw: 'https://example.com/manual' },
    ]);
  });

  it('detects multiple URLs', () => {
    const segs = segmentLinkifiedText('A https://a.example/x and https://b.example/y end');
    expect(segs.filter((s) => s.type === 'link').map((s) => s.type === 'link' && s.href)).toEqual([
      'https://a.example/x',
      'https://b.example/y',
    ]);
    expect(joined(segs)).toBe('A https://a.example/x and https://b.example/y end');
  });

  it('handles URL at beginning, middle, and end', () => {
    expect(segmentLinkifiedText('https://example.com start')[0]).toMatchObject({ type: 'link' });
    const mid = segmentLinkifiedText('go https://example.com now');
    expect(mid[1]).toMatchObject({ type: 'link', href: 'https://example.com' });
    const end = segmentLinkifiedText('end https://example.com');
    expect(end[end.length - 1]).toMatchObject({ type: 'link' });
  });

  it('keeps trailing sentence punctuation out of the href', () => {
    expect(segmentLinkifiedText('See https://example.com/test.')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', href: 'https://example.com/test', raw: 'https://example.com/test' },
      { type: 'text', value: '.' },
    ]);
    expect(joined(segmentLinkifiedText('https://example.com/test,'))).toBe('https://example.com/test,');
    expect(segmentLinkifiedText('https://example.com/test!')[0]).toMatchObject({
      href: 'https://example.com/test',
    });
  });

  it('handles wrapping parentheses without dropping path parens', () => {
    expect(segmentLinkifiedText('(https://example.com/test)')).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', href: 'https://example.com/test', raw: 'https://example.com/test' },
      { type: 'text', value: ')' },
    ]);
    const wiki = 'https://en.wikipedia.org/wiki/Example_(disambiguation)';
    expect(segmentLinkifiedText(wiki)).toEqual([{ type: 'link', href: wiki, raw: wiki }]);
  });

  it('preserves query strings, hashes, %20, and Unicode in href', () => {
    const q = 'https://example.com/x?store=TKC&utm_source=chat#top';
    expect(segmentLinkifiedText(`Open ${q}`)).toEqual([
      { type: 'text', value: 'Open ' },
      { type: 'link', href: q, raw: q },
    ]);
    const encoded = 'https://example.com/a%20b';
    expect(segmentLinkifiedText(encoded)[0]).toMatchObject({ href: encoded });
    const unicode = 'https://example.com/café/路径';
    expect(segmentLinkifiedText(unicode)[0]).toMatchObject({ href: unicode });
  });

  it('keeps a very long URL intact in href', () => {
    const href = `https://example.com/path?q=${'a'.repeat(1000)}`;
    const segs = segmentLinkifiedText(href);
    expect(segs).toEqual([{ type: 'link', href, raw: href }]);
  });

  it('leaves malformed and schemeless text alone', () => {
    expect(segmentLinkifiedText('https://')).toEqual([{ type: 'text', value: 'https://' }]);
    expect(segmentLinkifiedText('www.example.com')).toEqual([
      { type: 'text', value: 'www.example.com' },
    ]);
    expect(segmentLinkifiedText('example.com/foo')).toEqual([
      { type: 'text', value: 'example.com/foo' },
    ]);
  });

  it('does not linkify unsafe schemes or HTML-looking strings', () => {
    const samples = [
      'javascript:alert(1)',
      'data:text/html,hi',
      'vbscript:msg',
      '<a href="javascript:alert(1)">test</a>',
      '<a href="https://example.com">test</a>',
    ];
    for (const sample of samples) {
      const segs = segmentLinkifiedText(sample);
      expect(segs.some((s) => s.type === 'link')).toBe(false);
      expect(joined(segs)).toBe(sample);
    }
  });

  it('does not treat @ in surrounding text or URL paths as special', () => {
    const withAt = 'hi @Ada see https://example.com/@something';
    const segs = segmentLinkifiedText(withAt);
    expect(joined(segs)).toBe(withAt);
    expect(segs.find((s) => s.type === 'link')).toMatchObject({
      href: 'https://example.com/@something',
    });
  });
});

describe('displayUrlLabel / displayUrlParts', () => {
  it('never hides hostname and strips www + scheme', () => {
    expect(displayUrlLabel('https://www.example.com/manual')).toBe('example.com/manual');
    expect(displayUrlParts('https://www.example.com/manual').hostname).toBe('example.com');
  });

  it('omits query and hash from the visible label but callers keep full href', () => {
    const href =
      'https://example.com/operations/reports/august-2026?store=TKC&utm_source=chat#frag';
    expect(displayUrlLabel(href)).toBe('example.com/operations/reports/august-2026…');
    expect(displayUrlParts(href).hostname).toBe('example.com');
  });

  it('truncates a very long path without dropping the host', () => {
    const href = `https://example.com/${'segment/'.repeat(20)}end`;
    const label = displayUrlLabel(href);
    expect(label.startsWith('example.com/')).toBe(true);
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThan(href.length);
  });
});

describe('isStandaloneUrlLine', () => {
  it('is true only when the trimmed line is exactly one http(s) URL', () => {
    expect(isStandaloneUrlLine('https://example.com/manual')).toBe(true);
    expect(isStandaloneUrlLine('  http://example.com  ')).toBe(true);
    expect(isStandaloneUrlLine('See https://example.com/manual')).toBe(false);
    expect(isStandaloneUrlLine('https://example.com/test.')).toBe(false);
    expect(isStandaloneUrlLine('javascript:alert(1)')).toBe(false);
    expect(isStandaloneUrlLine('')).toBe(false);
  });
});

describe('trimTrailingUrlPunctuation', () => {
  it('trims simple punctuation and extra closing parens', () => {
    expect(trimTrailingUrlPunctuation('https://example.com/test.')).toBe('https://example.com/test');
    expect(trimTrailingUrlPunctuation('https://example.com/test)')).toBe('https://example.com/test');
    expect(trimTrailingUrlPunctuation('https://example.com/wiki/Foo_(bar)')).toBe(
      'https://example.com/wiki/Foo_(bar)',
    );
  });
});
