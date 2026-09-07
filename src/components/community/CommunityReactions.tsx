import { lazy, Suspense, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { applyCounterDelta, uniqueReactorDelta } from '../../lib/communityCounters';
import { isGiphyConfigured, type GiphyMediaItem } from '../../lib/giphyClient';
import {
  QUICK_UNICODE_REACTIONS,
  giphyReactionDisplayUrl,
  groupGiphyReactions,
  groupUnicodeReactions,
  resolveGiphyReactionToggle,
  resolveUnicodeReactionToggle,
  type ChatReaction,
} from '../../lib/storeChatReactions';
import { nowIso } from '../../lib/utils';
import type { CommunityPost, CommunityReaction } from '../../types';

const GiphyPicker = lazy(() =>
  import('../floating-assistant/GiphyPicker').then((m) => ({ default: m.GiphyPicker })),
);

const reactionLocks = new Set<string>();

function asChatReaction(row: CommunityReaction): ChatReaction {
  return {
    id: row.id,
    storeId: '',
    messageId: row.postId,
    userId: row.userId,
    reactionType: row.reactionType,
    unicode: row.unicode,
    giphyId: row.giphyId,
    giphyKind: row.giphyKind,
    giphyTitle: row.giphyTitle,
    giphyUrl: row.giphyUrl,
    giphyPreviewUrl: row.giphyPreviewUrl,
    createdAt: row.createdAt,
    clientMutationId: row.clientMutationId,
  };
}

function postReactions(rows: CommunityReaction[], postId: string): CommunityReaction[] {
  return rows.filter((row) => row.postId === postId && !(row.commentId || '').trim());
}

interface Props {
  post: CommunityPost;
  reactions: CommunityReaction[];
  userId: string;
}

export default function CommunityReactions({ post, reactions, userId }: Props) {
  const { t } = useLang();
  const sc = t.storeChat;
  const [trayOpen, setTrayOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const giphyBtnRef = useRef<HTMLButtonElement>(null);
  const giphyConfigured = isGiphyConfigured();

  const existing = postReactions(reactions, post.id);
  const asChat = existing.map(asChatReaction);
  const unicodeGroups = groupUnicodeReactions(asChat, userId);
  const giphyGroups = groupGiphyReactions(asChat, userId);
  const hasReactions = unicodeGroups.length > 0 || giphyGroups.length > 0;

  async function applyUnicode(unicode: string) {
    if (!userId) return;
    let decision;
    try {
      decision = resolveUnicodeReactionToggle(asChat, {
        messageId: post.id,
        userId,
        unicode,
      });
    } catch {
      return;
    }
    await persist(decision, existing);
  }

  async function applyGiphy(giphyId: string, item?: GiphyMediaItem | null) {
    if (!userId) return;
    let decision;
    try {
      decision = resolveGiphyReactionToggle(asChat, {
        messageId: post.id,
        userId,
        giphyId,
        item,
      });
    } catch {
      return;
    }
    await persist(decision, existing);
  }

  async function persist(
    decision: ReturnType<typeof resolveUnicodeReactionToggle> | ReturnType<typeof resolveGiphyReactionToggle>,
    existingRows: CommunityReaction[],
  ) {
    if (reactionLocks.has(decision.identityKey) || reactionLocks.has(`post:${post.id}`)) return;
    reactionLocks.add(decision.identityKey);
    reactionLocks.add(`post:${post.id}`);
    setError(null);
    const delta = uniqueReactorDelta(existingRows, userId, decision.action);
    const uniqueReactorCount = applyCounterDelta(post.uniqueReactorCount, delta);
    const lastActivityAt = nowIso();
    try {
      if (decision.action === 'add') {
        const reactionId = id();
        await db.transact([
          db.tx.communityReactions[reactionId]
            .update({
              postId: post.id,
              userId: decision.payload.userId,
              commentId: '',
              reactionType: decision.payload.reactionType,
              unicode: decision.payload.unicode,
              giphyId: decision.payload.giphyId,
              giphyKind: decision.payload.giphyKind,
              giphyTitle: decision.payload.giphyTitle,
              giphyUrl: decision.payload.giphyUrl,
              giphyPreviewUrl: decision.payload.giphyPreviewUrl,
              createdAt: lastActivityAt,
              clientMutationId: decision.clientMutationId,
            })
            .link({ post: post.id }),
          db.tx.communityPosts[post.id].update({ uniqueReactorCount, lastActivityAt }),
        ]);
      } else {
        await db.transact([
          db.tx.communityReactions[decision.reactionId].delete(),
          db.tx.communityPosts[post.id].update({ uniqueReactorCount, lastActivityAt }),
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update reaction. Try again.');
    } finally {
      reactionLocks.delete(decision.identityKey);
      reactionLocks.delete(`post:${post.id}`);
    }
  }

  return (
    <div className="community-reactions">
      {hasReactions ? (
        <div className="fa-msg-reactions" role="group" aria-label={sc.reactions}>
          {unicodeGroups.map((group) => {
            const actionHint = group.reactedByMe ? sc.activateRemoveReaction : sc.activateAddReaction;
            const countLabel = (
              group.count === 1 ? sc.reactionSingular : sc.reactionPlural
            ).replace('{count}', String(group.count));
            return (
              <button
                key={group.unicode}
                type="button"
                className={`fa-reaction-chip${group.reactedByMe ? ' fa-reaction-chip--mine' : ''}`}
                aria-pressed={group.reactedByMe}
                aria-label={`${group.unicode}, ${countLabel}. ${actionHint}`}
                onClick={() => void applyUnicode(group.unicode)}
              >
                <span className="fa-reaction-chip-emoji" aria-hidden="true">
                  {group.unicode}
                </span>
                <span className="fa-reaction-chip-count">{group.count}</span>
              </button>
            );
          })}
          {giphyGroups.map((group) => {
            const actionHint = group.reactedByMe
              ? sc.activateRemoveGifReaction
              : sc.activateAddGifReaction;
            const preview = giphyReactionDisplayUrl(group);
            const title = group.giphyTitle || sc.gifReaction;
            const countLabel = (
              group.count === 1 ? sc.reactionSingular : sc.reactionPlural
            ).replace('{count}', String(group.count));
            return (
              <button
                key={`giphy-${group.giphyId}`}
                type="button"
                className={`fa-reaction-chip fa-reaction-chip--giphy${group.reactedByMe ? ' fa-reaction-chip--mine' : ''}`}
                aria-pressed={group.reactedByMe}
                aria-label={`${title}, ${countLabel}. ${actionHint}`}
                onClick={() => void applyGiphy(group.giphyId)}
              >
                {preview ? (
                  <img
                    className="fa-reaction-chip-giphy"
                    src={preview}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="fa-reaction-chip-emoji" aria-hidden="true">
                    {sc.gif}
                  </span>
                )}
                <span className="fa-reaction-chip-count">{group.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        className="community-react-btn"
        aria-expanded={trayOpen}
        onClick={() => {
          setTrayOpen((open) => !open);
          setPickerOpen(false);
        }}
        aria-label={trayOpen ? sc.closeReactionTray : sc.react}
      >
        {sc.react}
      </button>

      {trayOpen ? (
        <div className="fa-reaction-tray" role="toolbar" aria-label={sc.quickReactions}>
          {QUICK_UNICODE_REACTIONS.map((emoji) => {
            const mine = unicodeGroups.some((g) => g.unicode === emoji && g.reactedByMe);
            return (
              <button
                key={emoji}
                type="button"
                className={`fa-reaction-tray-btn${mine ? ' fa-reaction-tray-btn--mine' : ''}`}
                aria-label={(mine ? sc.removeReaction : sc.addReaction).replace('{emoji}', emoji)}
                aria-pressed={mine}
                onClick={() => void applyUnicode(emoji)}
              >
                {emoji}
              </button>
            );
          })}
          {giphyConfigured ? (
            <button
              ref={giphyBtnRef}
              type="button"
              className="fa-reaction-tray-btn fa-reaction-tray-btn--giphy"
              aria-label={sc.searchGiphyReactions}
              onClick={() => setPickerOpen(true)}
            >
              {sc.gif}
            </button>
          ) : null}
        </div>
      ) : null}

      {pickerOpen && giphyConfigured ? (
        <Suspense fallback={null}>
          <GiphyPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            anchorRef={giphyBtnRef}
            onSelect={(item) => {
              setPickerOpen(false);
              void applyGiphy(item.id, item);
            }}
          />
        </Suspense>
      ) : null}

      {error ? <span className="community-card-error">{error}</span> : null}
    </div>
  );
}
