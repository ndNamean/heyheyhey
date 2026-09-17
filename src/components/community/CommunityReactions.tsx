import { lazy, Suspense, useRef, useState } from 'react';
import { id } from '@instantdb/react';
import { db } from '../../db';
import { useLang } from '../../i18n';
import { applyCounterDelta, uniqueReactorDelta } from '../../lib/communityCounters';
import { commentReactions, postReactions } from '../../lib/communityReactions';
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
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import { nowIso } from '../../lib/utils';
import type { CommunityPost, CommunityReaction } from '../../types';
import { reactionWhoNames } from '../../lib/communityReactionPeople';
import CommunityReactionWho from './CommunityReactionWho';

const GiphyPicker = lazy(() =>
  import('../floating-assistant/GiphyPicker').then((m) => ({ default: m.GiphyPicker })),
);

const reactionLocks = new Set<string>();

function asChatReaction(row: CommunityReaction, messageId: string): ChatReaction {
  return {
    id: row.id,
    storeId: '',
    messageId,
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

const EMPTY_PROFILES = new Map<string, AvatarProfileFields>();

interface Props {
  post: CommunityPost;
  reactions: CommunityReaction[];
  userId: string;
  reactorProfiles?: ReadonlyMap<string, AvatarProfileFields>;
  /** '' = post reactions (default). Nonempty = that comment/reply. */
  commentId?: string;
}

export default function CommunityReactions({
  post,
  reactions,
  userId,
  reactorProfiles = EMPTY_PROFILES,
  commentId = '',
}: Props) {
  const { t } = useLang();
  const sc = t.storeChat;
  const [trayOpen, setTrayOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const giphyBtnRef = useRef<HTMLButtonElement>(null);
  const giphyConfigured = isGiphyConfigured();
  const scopedCommentId = (commentId || '').trim();
  const isCommentScope = Boolean(scopedCommentId);
  const identityMessageId = isCommentScope ? scopedCommentId : post.id;

  const existing = isCommentScope
    ? commentReactions(reactions, post.id, scopedCommentId)
    : postReactions(reactions, post.id);
  const asChat = existing.map((row) => asChatReaction(row, identityMessageId));
  const unicodeGroups = groupUnicodeReactions(asChat, userId);
  const giphyGroups = groupGiphyReactions(asChat, userId);
  const hasReactions = unicodeGroups.length > 0 || giphyGroups.length > 0;
  const scopeLock = isCommentScope ? `comment:${scopedCommentId}` : `post:${post.id}`;

  async function applyUnicode(unicode: string) {
    if (!userId) return;
    let decision;
    try {
      decision = resolveUnicodeReactionToggle(asChat, {
        messageId: identityMessageId,
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
        messageId: identityMessageId,
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
    if (reactionLocks.has(decision.identityKey) || reactionLocks.has(scopeLock)) return;
    reactionLocks.add(decision.identityKey);
    reactionLocks.add(scopeLock);
    setError(null);
    const lastActivityAt = nowIso();
    try {
      if (decision.action === 'add') {
        const reactionId = id();
        const reactionTx = db.tx.communityReactions[reactionId]
          .update({
            postId: post.id,
            userId: decision.payload.userId,
            commentId: isCommentScope ? scopedCommentId : '',
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
          .link({ post: post.id });
        if (isCommentScope) {
          await db.transact([reactionTx]);
        } else {
          const delta = uniqueReactorDelta(existingRows, userId, decision.action);
          const uniqueReactorCount = applyCounterDelta(post.uniqueReactorCount, delta);
          await db.transact([
            reactionTx,
            db.tx.communityPosts[post.id].update({ uniqueReactorCount, lastActivityAt }),
          ]);
        }
      } else if (isCommentScope) {
        await db.transact([db.tx.communityReactions[decision.reactionId].delete()]);
      } else {
        const delta = uniqueReactorDelta(existingRows, userId, decision.action);
        const uniqueReactorCount = applyCounterDelta(post.uniqueReactorCount, delta);
        await db.transact([
          db.tx.communityReactions[decision.reactionId].delete(),
          db.tx.communityPosts[post.id].update({ uniqueReactorCount, lastActivityAt }),
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update reaction. Try again.');
    } finally {
      reactionLocks.delete(decision.identityKey);
      reactionLocks.delete(scopeLock);
    }
  }

  return (
    <div className={`community-reactions${isCommentScope ? ' community-reactions--comment' : ''}`}>
      {hasReactions ? (
        <div className="fa-msg-reactions" role="group" aria-label={sc.reactions}>
          {unicodeGroups.map((group) => {
            const actionHint = group.reactedByMe ? sc.activateRemoveReaction : sc.activateAddReaction;
            const countLabel = (
              group.count === 1 ? sc.reactionSingular : sc.reactionPlural
            ).replace('{count}', String(group.count));
            const who = reactionWhoNames(group.userIds, reactorProfiles, sc.someone);
            return (
              <CommunityReactionWho
                key={group.unicode}
                userIds={group.userIds}
                profilesByUserId={reactorProfiles}
                heading={sc.whoReacted}
                unknownLabel={sc.someone}
              >
                <button
                  type="button"
                  className={`fa-reaction-chip${group.reactedByMe ? ' fa-reaction-chip--mine' : ''}`}
                  aria-pressed={group.reactedByMe}
                  aria-label={`${group.unicode}, ${countLabel}. ${sc.whoReacted}: ${who}. ${actionHint}`}
                  onClick={() => void applyUnicode(group.unicode)}
                >
                  <span className="fa-reaction-chip-emoji" aria-hidden="true">
                    {group.unicode}
                  </span>
                  <span className="fa-reaction-chip-count">{group.count}</span>
                </button>
              </CommunityReactionWho>
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
            const who = reactionWhoNames(group.userIds, reactorProfiles, sc.someone);
            return (
              <CommunityReactionWho
                key={`giphy-${group.giphyId}`}
                userIds={group.userIds}
                profilesByUserId={reactorProfiles}
                heading={sc.whoReacted}
                unknownLabel={sc.someone}
              >
                <button
                  type="button"
                  className={`fa-reaction-chip fa-reaction-chip--giphy${group.reactedByMe ? ' fa-reaction-chip--mine' : ''}`}
                  aria-pressed={group.reactedByMe}
                  aria-label={`${title}, ${countLabel}. ${sc.whoReacted}: ${who}. ${actionHint}`}
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
              </CommunityReactionWho>
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
