import {
  messageHasChatAttachment,
  resolveChatAttachmentUrl,
} from './chatAttachmentDisplay';

export function isCommunityVideoPost(post: {
  attachmentKind?: string;
  attachmentPath?: string;
  attachmentFileId?: string;
  attachmentUrl?: string;
  attachmentFile?: { url?: string; id?: string } | null;
}): boolean {
  return (
    messageHasChatAttachment(post) &&
    String(post.attachmentKind || '').trim() === 'video' &&
    Boolean(resolveChatAttachmentUrl(post))
  );
}

export function communityVideoAspectRatio(
  width?: number | string | null,
  height?: number | string | null,
): string {
  const w = typeof width === 'string' ? Number.parseInt(width, 10) : Number(width);
  const h = typeof height === 'string' ? Number.parseInt(height, 10) : Number(height);
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return '16 / 9';
}
