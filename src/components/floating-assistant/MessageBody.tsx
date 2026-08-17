import { Fragment } from 'react';
import { LinkifiedText, SafeExternalLink } from '../LinkifiedText';
import {
  isStandaloneUrlLine,
  segmentLinkifiedText,
} from '../../lib/linkifyText';
import {
  parseMentionedUserIdsJson,
  segmentMentionBody,
  type MentionCandidate,
} from '../../lib/storeChatMentions';

export function MessageBody({
  body,
  mentionedUserIdsJson,
  mentionAll,
  candidates,
  className = 'fa-msg-body',
}: {
  body: string;
  mentionedUserIdsJson?: string;
  mentionAll?: boolean;
  candidates: MentionCandidate[];
  className?: string;
}) {
  const mentionedIds = parseMentionedUserIdsJson(mentionedUserIdsJson);
  const lines = body.split('\n');

  return (
    <p className={className}>
      {lines.map((line, i) => {
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

        const segments = segmentMentionBody(
          line,
          mentionedIds,
          Boolean(mentionAll),
          candidates,
        );
        return (
          <Fragment key={i}>
            {segments.map((seg, j) =>
              seg.type === 'mention' ? (
                <span key={`m-${j}`} className="fa-msg-mention">
                  {seg.value}
                </span>
              ) : (
                <LinkifiedText key={`t-${j}`} text={seg.value} standalone="never" />
              ),
            )}
            {nl}
          </Fragment>
        );
      })}
    </p>
  );
}
