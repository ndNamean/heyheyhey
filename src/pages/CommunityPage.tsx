import { useCallback, useEffect, useMemo, useState } from 'react';
import CommunityComposer from '../components/community/CommunityComposer';
import CommunityPostCard from '../components/community/CommunityPostCard';
import CommunityPostDetail from '../components/community/CommunityPostDetail';
import FamousPost from '../components/community/FamousPost';
import CommunityDepthGallery from '../components/community/depth-gallery/CommunityDepthGallery';
import { isCommunityImagePost } from '../components/community/depth-gallery/gallerySet';
import { db } from '../db';
import { useLang } from '../i18n';
import {
  COMMUNITY_FAMOUS_UNDO_MS,
  castFamousVote,
  removeFamousVote,
  toggleFamousVote,
} from '../lib/communityFamousVotes';
import {
  COMMUNITY_FAMOUS_CANDIDATE_LIMIT,
  COMMUNITY_FAMOUS_WINDOW_MS,
  famousWindowCutoffIso,
  selectFamousPost,
} from '../lib/communityRanking';
import type { CommunityFamousVote, CommunityPost, CommunityReaction, Profile } from '../types';

export const COMMUNITY_FEED_PAGE_SIZE = 15;

interface Props {
  profile: Profile;
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function addToSet(prev: Set<string>, id: string): Set<string> {
  if (prev.has(id)) return prev;
  const next = new Set(prev);
  next.add(id);
  return next;
}

function removeFromSet(prev: Set<string>, id: string): Set<string> {
  if (!prev.has(id)) return prev;
  const next = new Set(prev);
  next.delete(id);
  return next;
}

export default function CommunityPage({ profile }: Props) {
  const { t } = useLang();
  const copy = t.community;
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [galleryPostId, setGalleryPostId] = useState<string | null>(null);
  const [skipIds, setSkipIds] = useState<Set<string>>(() => new Set());
  const [famousBusy, setFamousBusy] = useState<Set<string>>(() => new Set());
  const [undoToast, setUndoToast] = useState<{ postId: string; voteId: string } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [famousCutoffIso] = useState(() => famousWindowCutoffIso());

  const infiniteQuery = useMemo(
    () => ({
      communityPosts: {
        $: {
          where: { status: 'active' },
          order: { createdAt: 'desc' as const },
          limit: COMMUNITY_FEED_PAGE_SIZE,
        },
        author: { avatarFile: {} },
        attachmentFile: {},
      },
    }),
    [],
  );

  const {
    data: pageData,
    isLoading: listLoading,
    canLoadNextPage,
    loadNextPage,
    error: listError,
  } = db.useInfiniteQuery(infiniteQuery);

  const famousQuery = useMemo(
    () => ({
      communityPosts: {
        $: {
          where: {
            status: 'active',
            createdAt: { $gte: famousCutoffIso },
          },
          order: { famousVoteCount: 'desc' as const },
          limit: COMMUNITY_FAMOUS_CANDIDATE_LIMIT,
        },
        author: { avatarFile: {} },
        attachmentFile: {},
      },
    }),
    [famousCutoffIso],
  );

  const { data: famousData } = db.useQuery(famousQuery);

  const feedPosts = useMemo(
    () => dedupeById((pageData?.communityPosts ?? []) as CommunityPost[]),
    [pageData?.communityPosts],
  );

  const famousPost = useMemo(() => {
    const candidates = (famousData?.communityPosts ?? []) as CommunityPost[];
    return selectFamousPost(candidates, Date.now(), COMMUNITY_FAMOUS_WINDOW_MS) as CommunityPost | null;
  }, [famousData?.communityPosts]);

  const postById = useMemo(() => {
    const map = new Map<string, CommunityPost>();
    if (famousPost) map.set(famousPost.id, famousPost);
    for (const post of feedPosts) map.set(post.id, post);
    return map;
  }, [famousPost, feedPosts]);

  const visiblePostIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id?: string | null) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    add(famousPost?.id);
    for (const post of feedPosts) add(post.id);
    add(selectedPostId);
    return ids;
  }, [famousPost?.id, feedPosts, selectedPostId]);

  const engagementQuery = useMemo(() => {
    if (!visiblePostIds.length) return null;
    return {
      communityReactions: {
        $: { where: { postId: { $in: visiblePostIds } } },
      },
      communityFamousVotes: {
        $: { where: { postId: { $in: visiblePostIds } } },
      },
    };
  }, [visiblePostIds]);

  const { data: engagementData } = db.useQuery(engagementQuery);

  const reactions = (engagementData?.communityReactions ?? []) as CommunityReaction[];
  const votes = (engagementData?.communityFamousVotes ?? []) as CommunityFamousVote[];

  const reactionsByPostId = useMemo(() => {
    const map = new Map<string, CommunityReaction[]>();
    for (const row of reactions) {
      if (!row.postId) continue;
      const list = map.get(row.postId);
      if (list) list.push(row);
      else map.set(row.postId, [row]);
    }
    return map;
  }, [reactions]);

  const myVoteByPostId = useMemo(() => {
    const map = new Map<string, string>();
    for (const vote of votes) {
      if (vote.userId !== profile.userId) continue;
      map.set(vote.postId, vote.id);
    }
    return map;
  }, [profile.userId, votes]);

  const gallerySource = useMemo(() => {
    const list: CommunityPost[] = [];
    if (famousPost && isCommunityImagePost(famousPost)) list.push(famousPost);
    for (const post of feedPosts) list.push(post);
    return list;
  }, [famousPost, feedPosts]);

  const selectedPost = selectedPostId ? postById.get(selectedPostId) ?? null : null;
  const showFamous = Boolean(famousPost && !skipIds.has(famousPost.id));
  const feedVisible = feedPosts.filter(
    (post) => post.id !== famousPost?.id && !skipIds.has(post.id),
  );
  const overlayOpen = Boolean(galleryPostId);
  const swipeEnabled = !overlayOpen;

  useEffect(() => {
    if (!undoToast) return;
    const timer = window.setTimeout(() => setUndoToast(null), COMMUNITY_FAMOUS_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undoToast]);

  const markBusy = useCallback((postId: string, busy: boolean) => {
    setFamousBusy((prev) => (busy ? addToSet(prev, postId) : removeFromSet(prev, postId)));
  }, []);

  const handleFamousCast = useCallback(
    async (post: CommunityPost) => {
      if (famousBusy.has(post.id)) return;
      markBusy(post.id, true);
      try {
        const result = await castFamousVote({
          postId: post.id,
          userId: profile.userId,
          famousVoteCount: post.famousVoteCount,
          existingVoteId: myVoteByPostId.get(post.id) ?? null,
        });
        if (result.ok && result.action === 'cast' && result.voteId) {
          setUndoToast({ postId: post.id, voteId: result.voteId });
        }
      } finally {
        markBusy(post.id, false);
      }
    },
    [famousBusy, markBusy, myVoteByPostId, profile.userId],
  );

  const handleFamousToggle = useCallback(
    async (post: CommunityPost) => {
      if (famousBusy.has(post.id)) return;
      markBusy(post.id, true);
      try {
        const existingVoteId = myVoteByPostId.get(post.id) ?? null;
        const result = await toggleFamousVote({
          postId: post.id,
          userId: profile.userId,
          famousVoteCount: post.famousVoteCount,
          existingVoteId,
        });
        if (result.ok && result.action === 'cast' && result.voteId) {
          setUndoToast({ postId: post.id, voteId: result.voteId });
        } else if (result.ok && result.action === 'remove') {
          setUndoToast((prev) => (prev?.postId === post.id ? null : prev));
        }
      } finally {
        markBusy(post.id, false);
      }
    },
    [famousBusy, markBusy, myVoteByPostId, profile.userId],
  );

  async function handleUndoFamous() {
    if (!undoToast) return;
    const post = postById.get(undoToast.postId);
    const toast = undoToast;
    setUndoToast(null);
    markBusy(toast.postId, true);
    try {
      await removeFamousVote({
        postId: toast.postId,
        userId: profile.userId,
        famousVoteCount: post?.famousVoteCount ?? 1,
        existingVoteId: toast.voteId,
      });
    } finally {
      markBusy(toast.postId, false);
    }
  }

  async function handleLoadMore() {
    if (!canLoadNextPage || isLoadingMore || typeof loadNextPage !== 'function') return;
    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      await Promise.resolve(loadNextPage());
    } catch {
      setLoadMoreError(true);
    } finally {
      setIsLoadingMore(false);
    }
  }

  function openGallery(post: CommunityPost) {
    if (!isCommunityImagePost(post)) return;
    setGalleryPostId(post.id);
  }

  const cardProps = {
    profile,
    swipeEnabled,
    onImageTap: openGallery,
    onOpenDetail: (post: CommunityPost) => setSelectedPostId(post.id),
    onFamousToggle: handleFamousToggle,
    onFamousCast: handleFamousCast,
    onSkip: (postId: string) => setSkipIds((prev) => addToSet(prev, postId)),
  };

  const listBody = (() => {
    if (listLoading && !feedPosts.length) {
      return <div className="community-feed-status">{copy.loading}</div>;
    }
    if (listError && !feedPosts.length) {
      return (
        <div className="community-feed-status">
          {copy.loadError}{' '}
          <button type="button" className="secondary" onClick={() => window.location.reload()}>
            {copy.retry}
          </button>
        </div>
      );
    }
    if (!showFamous && !feedVisible.length) {
      return <p className="small community-feed-empty">{copy.placeholder}</p>;
    }
    return (
      <>
        {showFamous && famousPost ? (
          <FamousPost
            post={famousPost}
            reactions={reactionsByPostId.get(famousPost.id) ?? []}
            famousVoted={myVoteByPostId.has(famousPost.id)}
            famousInFlight={famousBusy.has(famousPost.id)}
            {...cardProps}
          />
        ) : null}
        {feedVisible.map((post) => (
          <CommunityPostCard
            key={post.id}
            post={post}
            reactions={reactionsByPostId.get(post.id) ?? []}
            famousVoted={myVoteByPostId.has(post.id)}
            famousInFlight={famousBusy.has(post.id)}
            {...cardProps}
          />
        ))}
        {(canLoadNextPage || loadMoreError) && (
          <div className="community-feed-more">
            {loadMoreError ? (
              <div className="community-feed-status">{copy.loadMoreError}</div>
            ) : null}
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore
                ? `${copy.loadMore}...`
                : loadMoreError
                  ? copy.retry
                  : copy.loadMore}
            </button>
          </div>
        )}
      </>
    );
  })();

  return (
    <div className="community-page">
      <header className="community-page-header card">
        <h1>{t.pages.community}</h1>
        <button type="button" onClick={() => setComposerOpen(true)}>
          {copy.newPost}
        </button>
      </header>
      <div className="community-feed">{listBody}</div>
      {composerOpen ? (
        <CommunityComposer profile={profile} onClose={() => setComposerOpen(false)} />
      ) : null}
      {selectedPostId ? (
        <CommunityPostDetail
          post={selectedPost}
          profile={profile}
          reactions={selectedPost ? reactionsByPostId.get(selectedPost.id) ?? [] : []}
          famousVoted={selectedPost ? myVoteByPostId.has(selectedPost.id) : false}
          famousInFlight={selectedPost ? famousBusy.has(selectedPost.id) : false}
          onClose={() => setSelectedPostId(null)}
          onImageTap={openGallery}
          onFamousToggle={handleFamousToggle}
          onFamousCast={handleFamousCast}
        />
      ) : null}
      {galleryPostId ? (
        <CommunityDepthGallery
          sourcePosts={gallerySource}
          startPostId={galleryPostId}
          onClose={() => setGalleryPostId(null)}
        />
      ) : null}
      {undoToast ? (
        <div className="community-undo-toast" role="status">
          <span>{copy.famousUndoToast}</span>
          <button type="button" onClick={() => void handleUndoFamous()}>
            {copy.undoFamous}
          </button>
        </div>
      ) : null}
    </div>
  );
}
