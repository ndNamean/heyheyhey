import type { AvatarProfileFields } from './avatarDisplay';
import type { Profile, Role } from '../types';

export const MENTION_ALL_TOKEN = 'all';

/** Matches Instant / Store Chat room access (owner | admin | areaManager). */
function hasAllStoreChatAccess(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'areaManager';
}

export interface MentionCandidate {
  userId: string;
  label: string;
  email: string;
  profile: AvatarProfileFields;
}

export interface SelectedMention {
  userId: string;
  label: string;
}

export interface ActiveMentionQuery {
  /** Index of the `@` that started this token. */
  start: number;
  /** Text after `@` up to the caret (may be empty). */
  query: string;
}

export type MentionMenuItem =
  | { kind: 'all'; label: typeof MENTION_ALL_TOKEN }
  | { kind: 'user'; candidate: MentionCandidate };

export type BodySegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; userId?: string; isAll?: boolean };

export function mentionDisplayLabel(profile: Pick<Profile, 'displayName' | 'email'>): string {
  const name = profile.displayName?.trim();
  if (name) return name;
  const local = profile.email?.split('@')[0]?.trim();
  return local || 'user';
}

export function canAccessStoreChatRoom(
  profile: Pick<Profile, 'role' | 'stores'>,
  storeId: string,
): boolean {
  if (!storeId) return false;
  if (hasAllStoreChatAccess(profile.role)) return true;
  return (profile.stores ?? []).some((s) => s.id === storeId);
}

function profileToMentionCandidate(p: Profile): MentionCandidate {
  const label = mentionDisplayLabel(p);
  return {
    userId: p.userId,
    label,
    email: p.email ?? '',
    profile: {
      displayName: p.displayName,
      email: p.email,
      userId: p.userId,
      avatarUrl: p.avatarUrl,
      avatarPath: p.avatarPath,
      avatarFile: p.avatarFile,
    },
  };
}

/** Sort mention candidates by label then email. */
export function sortMentionCandidates(candidates: MentionCandidate[]): MentionCandidate[] {
  return candidates
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label) || a.email.localeCompare(b.email));
}

/** Approved profiles who can see the store room, excluding the sender. */
export function buildMentionCandidates(
  profiles: Profile[],
  storeId: string,
  excludeUserId: string,
): MentionCandidate[] {
  const out: MentionCandidate[] = [];
  for (const p of profiles) {
    if (p.approvalStatus !== 'approved') continue;
    if (!p.userId || p.userId === excludeUserId) continue;
    if (!canAccessStoreChatRoom(p, storeId)) continue;
    out.push(profileToMentionCandidate(p));
  }
  return sortMentionCandidates(out);
}

/**
 * Group Chat mention candidates from active room members (+ optional @all via menu builder).
 * Excludes `excludeUserId`. Uses linked member profiles when present.
 */
export function buildGroupMentionCandidates(
  members: Array<{
    userId: string;
    profile?: Pick<Profile, 'displayName' | 'email' | 'userId' | 'avatarUrl' | 'avatarPath' | 'avatarFile' | 'approvalStatus'> | null;
  }>,
  excludeUserId: string,
): MentionCandidate[] {
  const out: MentionCandidate[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const userId = (m.userId || m.profile?.userId || '').trim();
    if (!userId || userId === excludeUserId || seen.has(userId)) continue;
    if (m.profile?.approvalStatus && m.profile.approvalStatus !== 'approved') continue;
    seen.add(userId);
    const p = m.profile;
    const label = mentionDisplayLabel({
      displayName: p?.displayName ?? '',
      email: p?.email ?? '',
    });
    out.push({
      userId,
      label,
      email: p?.email ?? '',
      profile: {
        displayName: p?.displayName,
        email: p?.email,
        userId,
        avatarUrl: p?.avatarUrl,
        avatarPath: p?.avatarPath,
        avatarFile: p?.avatarFile,
      },
    });
  }
  return sortMentionCandidates(out);
}

/**
 * Detect an in-progress `@query` at the caret.
 * Token starts after whitespace/start-of-string; ends at caret (no spaces in query while typing).
 */
export function getActiveMentionQuery(text: string, caret: number): ActiveMentionQuery | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0) {
    const prev = before[at - 1];
    if (prev && !/\s/.test(prev)) return null;
  }
  const query = before.slice(at + 1);
  if (/[\n]/.test(query)) return null;
  // While composing, query must not contain spaces (multi-word labels are inserted whole).
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => {
    const label = c.label.toLowerCase();
    const email = c.email.toLowerCase();
    const local = email.split('@')[0] ?? '';
    return label.includes(q) || email.includes(q) || local.includes(q);
  });
}

export function buildMentionMenuItems(
  candidates: MentionCandidate[],
  query: string,
): MentionMenuItem[] {
  const q = query.trim().toLowerCase();
  const items: MentionMenuItem[] = [];
  const allMatches = !q || MENTION_ALL_TOKEN.startsWith(q) || 'everyone'.startsWith(q);
  if (allMatches) {
    items.push({ kind: 'all', label: MENTION_ALL_TOKEN });
  }
  for (const c of filterMentionCandidates(candidates, query)) {
    items.push({ kind: 'user', candidate: c });
  }
  return items;
}

export function insertMentionToken(
  text: string,
  caret: number,
  label: string,
): { text: string; caret: number } | null {
  const active = getActiveMentionQuery(text, caret);
  if (!active) return null;
  const inserted = `@${label} `;
  const next = text.slice(0, active.start) + inserted + text.slice(caret);
  return { text: next, caret: active.start + inserted.length };
}

export function parseMentionedUserIdsJson(raw: string | undefined | null): string[] {
  if (!raw || raw === '[]') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
      ),
    ];
  } catch {
    return [];
  }
}

export function serializeMentionedUserIds(ids: string[]): string {
  return JSON.stringify([...new Set(ids.filter(Boolean))]);
}

/**
 * Match `@Label` tokens in body against known labels (longest-first).
 * Labels may contain spaces (e.g. display names).
 */
function findLabelMatch(
  body: string,
  from: number,
  labels: string[],
): string | null {
  if (body[from] !== '@') return null;
  let best: string | null = null;
  for (const label of labels) {
    const token = `@${label}`;
    if (!body.startsWith(token, from)) continue;
    const end = from + token.length;
    const next = body[end];
    // Boundary: end, whitespace, or punctuation (not another word char / letter).
    if (next !== undefined && !/[\s.,!?;:)\]}]/.test(next) && /[\w-]/.test(next)) {
      continue;
    }
    if (!best || label.length > best.length) best = label;
  }
  return best;
}

function uniqueLabelsByLongest(labels: Iterable<string>): string[] {
  return [...new Set([...labels].filter(Boolean))].sort((a, b) => b.length - a.length);
}

/** Mentions still present in the body (tracked + unique pasted name matches). */
export function resolveMentionPayload(
  body: string,
  tracked: SelectedMention[],
  mentionAllTracked: boolean,
  candidates: MentionCandidate[],
): { mentionedUserIds: string[]; mentionAll: boolean } {
  const labels = uniqueLabelsByLongest([
    MENTION_ALL_TOKEN,
    ...candidates.map((c) => c.label),
    ...tracked.map((t) => t.label),
  ]);

  const labelToUserIds = new Map<string, string[]>();
  for (const c of candidates) {
    const key = c.label.toLowerCase();
    const list = labelToUserIds.get(key) ?? [];
    list.push(c.userId);
    labelToUserIds.set(key, list);
  }

  const trackedByLabel = new Map(
    tracked.map((t) => [t.label.toLowerCase(), t.userId] as const),
  );

  let mentionAll = false;
  const ids = new Set<string>();

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@') continue;
    const matched = findLabelMatch(body, i, labels);
    if (!matched) continue;
    if (matched.toLowerCase() === MENTION_ALL_TOKEN) {
      mentionAll = true;
    } else {
      const key = matched.toLowerCase();
      const trackedId = trackedByLabel.get(key);
      if (trackedId) {
        ids.add(trackedId);
      } else {
        const matches = labelToUserIds.get(key) ?? [];
        if (matches.length === 1) ids.add(matches[0]!);
      }
    }
    i += matched.length; // skip past label (loop +1)
  }

  if (mentionAllTracked && body.toLowerCase().includes(`@${MENTION_ALL_TOKEN}`)) {
    mentionAll = true;
  }

  return { mentionedUserIds: [...ids], mentionAll };
}

/** Recipients for notifications (never includes sender). */
export function expandMentionRecipients(
  mentionedUserIds: string[],
  mentionAll: boolean,
  candidates: MentionCandidate[],
  senderUserId: string,
): string[] {
  const set = new Set<string>();
  if (mentionAll) {
    for (const c of candidates) {
      if (c.userId && c.userId !== senderUserId) set.add(c.userId);
    }
  }
  for (const uid of mentionedUserIds) {
    if (uid && uid !== senderUserId) set.add(uid);
  }
  return [...set];
}

export function segmentMentionBody(
  body: string,
  mentionedUserIds: string[],
  mentionAll: boolean,
  candidates: MentionCandidate[],
): BodySegment[] {
  if (!body) return [{ type: 'text', value: '' }];

  const idSet = new Set(mentionedUserIds);
  const mentionable = candidates.filter(
    (c) => idSet.has(c.userId) || mentionAll,
  );
  const labels = uniqueLabelsByLongest([
    ...(mentionAll ? [MENTION_ALL_TOKEN] : []),
    ...mentionable.map((c) => c.label),
    // Also highlight any @all token when flag set even if not in candidates list
    ...(mentionAll ? [MENTION_ALL_TOKEN] : []),
  ]);

  if (labels.length === 0) return [{ type: 'text', value: body }];

  const labelToUserId = new Map<string, string>();
  for (const c of mentionable) {
    labelToUserId.set(c.label.toLowerCase(), c.userId);
  }

  const segments: BodySegment[] = [];
  let cursor = 0;

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '@') continue;
    const matched = findLabelMatch(body, i, labels);
    if (!matched) continue;

    if (i > cursor) {
      segments.push({ type: 'text', value: body.slice(cursor, i) });
    }

    const isAll = matched.toLowerCase() === MENTION_ALL_TOKEN;
    segments.push({
      type: 'mention',
      value: `@${matched}`,
      isAll,
      userId: isAll ? undefined : labelToUserId.get(matched.toLowerCase()),
    });

    const end = i + 1 + matched.length;
    cursor = end;
    i = end - 1;
  }

  if (cursor < body.length) {
    segments.push({ type: 'text', value: body.slice(cursor) });
  }

  return segments.length ? segments : [{ type: 'text', value: body }];
}
