import { useMemo, useState } from 'react';
import { db } from '../../db';
import type { AvatarProfileFields } from '../../lib/avatarDisplay';
import {
  COMMUNITY_BUILDERS_LIMIT,
  communityBuildersMonthStartIso,
  rankCommunityBuilders,
  type BuilderCommentRow,
  type BuilderPostRow,
  type BuilderReactionRow,
} from '../../lib/communityBuilders';
import { indexProfilesByUserId } from '../../lib/communityReactionPeople';

export type CommunityBuilderMember = AvatarProfileFields & { userId: string };

type ProfileRow = AvatarProfileFields & {
  userId?: string;
  approvalStatus?: string;
};

/**
 * Month-bounded Instant queries + pure selection + approved profile resolve.
 * Fail-open: never throws into the page; returns empty members on load/error/empty.
 */
export function useCommunityBuilders(): { members: CommunityBuilderMember[] } {
  const [monthStartIso] = useState(() => communityBuildersMonthStartIso());

  const sourceQuery = useMemo(
    () => ({
      communityPosts: {
        $: {
          where: {
            status: 'active',
            createdAt: { $gte: monthStartIso },
          },
        },
      },
      communityComments: {
        $: {
          where: {
            status: 'active',
            createdAt: { $gte: monthStartIso },
          },
        },
      },
      communityReactions: {
        $: {
          where: {
            createdAt: { $gte: monthStartIso },
          },
        },
      },
    }),
    [monthStartIso],
  );

  const { data: sourceData, isLoading: sourceLoading, error: sourceError } =
    db.useQuery(sourceQuery);

  const rankedUserIds = useMemo(() => {
    if (sourceLoading || sourceError) return [] as string[];
    try {
      const posts = (sourceData?.communityPosts ?? []) as BuilderPostRow[];
      const comments = (sourceData?.communityComments ?? []) as BuilderCommentRow[];
      const reactions = (sourceData?.communityReactions ?? []) as BuilderReactionRow[];
      return rankCommunityBuilders(posts, comments, reactions, {
        monthStartIso,
      }).map((row) => row.userId);
    } catch {
      return [] as string[];
    }
  }, [sourceData?.communityPosts, sourceData?.communityComments, sourceData?.communityReactions, sourceLoading, sourceError, monthStartIso]);

  const rankedKey = rankedUserIds.join('|');

  const profileQuery = useMemo(() => {
    if (!rankedUserIds.length) return null;
    return {
      profiles: {
        $: { where: { userId: { $in: rankedUserIds } } },
        avatarFile: {},
      },
    };
  }, [rankedUserIds, rankedKey]);

  const { data: profileData, isLoading: profileLoading, error: profileError } =
    db.useQuery(profileQuery);

  const members = useMemo((): CommunityBuilderMember[] => {
    if (sourceLoading || sourceError || profileLoading || profileError) return [];
    if (!rankedUserIds.length) return [];
    try {
      const rows = (profileData?.profiles ?? []) as ProfileRow[];
      const approved = rows.filter((p) => (p.approvalStatus || '').trim() === 'approved');
      const byUserId = indexProfilesByUserId(approved);
      const out: CommunityBuilderMember[] = [];
      for (const userId of rankedUserIds) {
        if (out.length >= COMMUNITY_BUILDERS_LIMIT) break;
        const profile = byUserId.get(userId);
        if (!profile) continue;
        out.push({ ...profile, userId });
      }
      return out;
    } catch {
      return [];
    }
  }, [
    rankedUserIds,
    rankedKey,
    profileData?.profiles,
    sourceLoading,
    sourceError,
    profileLoading,
    profileError,
  ]);

  return { members };
}
