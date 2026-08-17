// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LinkifiedText } from '../LinkifiedText';
import { MessageBody } from './MessageBody';
import type { MentionCandidate } from '../../lib/storeChatMentions';

afterEach(() => cleanup());

const candidates: MentionCandidate[] = [
  {
    userId: 'u1',
    label: 'Ada Lovelace',
    email: 'ada@ex.com',
    profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com', userId: 'u1' },
  },
];

describe('LinkifiedText', () => {
  it('renders http(s) as safe external anchors and leaves unsafe schemes as text', () => {
    render(
      <LinkifiedText
        text={'See https://example.com/manual before. javascript:alert(1)'}
        standalone="never"
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/manual');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toContain('opens in new tab');
    expect(link.getAttribute('aria-label')).toContain('example.com');
    expect(screen.queryByRole('link', { name: /javascript/i })).toBeNull();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeTruthy();
  });

  it('uses Mode B for a standalone URL line', () => {
    const { container } = render(
      <LinkifiedText text="https://example.com/operations/manual" />,
    );
    const link = screen.getByRole('link');
    expect(link.className).toContain('fa-link--standalone');
    expect(container.querySelector('.fa-link__host')?.textContent).toBe('example.com');
    expect(container.querySelector('.fa-link__path')?.textContent).toBe('/operations/manual');
  });

  it('preserves line breaks around inline links', () => {
    const { container } = render(
      <LinkifiedText
        text={'line one\nSee https://example.com/x\nline three'}
        standalone="never"
      />,
    );
    expect(container.textContent).toContain('line one');
    expect(container.textContent).toContain('\n');
    expect(container.textContent).toContain('line three');
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com/x');
  });
});

describe('MessageBody', () => {
  it('keeps mentions and linkifies URLs in the remaining text', () => {
    render(
      <MessageBody
        body="@Ada Lovelace please review https://example.com/report"
        mentionedUserIdsJson='["u1"]'
        mentionAll={false}
        candidates={candidates}
      />,
    );
    expect(document.querySelector('.fa-msg-mention')?.textContent).toBe('@Ada Lovelace');
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/report');
    expect(link.className).toContain('fa-link--inline');
    expect(screen.getByText(/please review/)).toBeTruthy();
  });

  it('does not treat @ inside a URL path as a mention', () => {
    const pathCandidates: MentionCandidate[] = [
      {
        userId: 'u2',
        label: 'something',
        email: 's@ex.com',
        profile: { displayName: 'something', email: 's@ex.com', userId: 'u2' },
      },
    ];
    render(
      <MessageBody
        body="https://example.com/@something"
        mentionedUserIdsJson='["u2"]'
        mentionAll={false}
        candidates={pathCandidates}
      />,
    );
    expect(document.querySelector('.fa-msg-mention')).toBeNull();
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      'https://example.com/@something',
    );
  });
});
