import { Fragment, type ReactNode } from 'react';
import {
  displayUrlLabel,
  displayUrlParts,
  isStandaloneUrlLine,
  segmentLinkifiedText,
} from '../lib/linkifyText';
import './linkifiedText.css';

const OPENS_IN_NEW_TAB = 'opens in new tab';

function accessibleName(href: string): string {
  return `${displayUrlLabel(href)} (${OPENS_IN_NEW_TAB})`;
}

export function SafeExternalLink({
  href,
  mode = 'inline',
}: {
  href: string;
  mode?: 'inline' | 'standalone';
}) {
  const label = displayUrlLabel(href);
  const parts = displayUrlParts(href);
  const name = accessibleName(href);

  function stopBubble(event: { stopPropagation: () => void }) {
    event.stopPropagation();
  }

  if (mode === 'standalone') {
    return (
      <a
        className="fa-link fa-link--standalone"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={name}
        onClick={stopBubble}
        onPointerDown={stopBubble}
      >
        <span className="fa-link__copy">
          <span className="fa-link__host">{parts.hostname}</span>
          {parts.path && parts.path !== '…' ? (
            <span className="fa-link__path">{parts.path}</span>
          ) : null}
        </span>
        <span className="fa-link__ext" aria-hidden="true">
          ↗
        </span>
      </a>
    );
  }

  return (
    <a
      className="fa-link fa-link--inline"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={name}
      onClick={stopBubble}
      onPointerDown={stopBubble}
    >
      <span className="fa-link__label">{label}</span>
      <span className="fa-link__ext" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}

function renderInline(text: string, keyPrefix: string): ReactNode {
  const segs = segmentLinkifiedText(text);
  return segs.map((seg, i) =>
    seg.type === 'link' ? (
      <SafeExternalLink key={`${keyPrefix}l-${i}`} href={seg.href} mode="inline" />
    ) : (
      <Fragment key={`${keyPrefix}t-${i}`}>{seg.value}</Fragment>
    ),
  );
}

export function LinkifiedText({
  text,
  className,
  as: Component,
  standalone = 'auto',
}: {
  text: string;
  className?: string;
  as?: 'p' | 'span' | 'div';
  /** `auto` uses Mode B for lines that are exactly one URL. `never` is always Mode A. */
  standalone?: 'auto' | 'never';
}) {
  let content: ReactNode;
  if (standalone === 'never') {
    content = renderInline(text, '');
  } else {
    const lines = text.split('\n');
    content = lines.map((line, i) => {
      const nl = i < lines.length - 1 ? '\n' : '';
      if (isStandaloneUrlLine(line)) {
        const segs = segmentLinkifiedText(line.trim());
        const link = segs[0];
        if (link && link.type === 'link') {
          return (
            <Fragment key={i}>
              <SafeExternalLink href={link.href} mode="standalone" />
              {nl}
            </Fragment>
          );
        }
      }
      return (
        <Fragment key={i}>
          {renderInline(line, `${i}-`)}
          {nl}
        </Fragment>
      );
    });
  }

  if (Component) {
    return <Component className={className}>{content}</Component>;
  }
  if (className) {
    return <span className={className}>{content}</span>;
  }
  return <>{content}</>;
}
