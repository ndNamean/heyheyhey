import { describe, expect, it } from 'vitest';
import type { Profile, Store } from '../types';
import {
  buildMentionCandidates,
  buildGroupMentionCandidates,
  buildMentionMenuItems,
  expandMentionRecipients,
  filterMentionCandidates,
  getActiveMentionQuery,
  insertMentionToken,
  mentionDisplayLabel,
  parseMentionedUserIdsJson,
  resolveMentionPayload,
  segmentMentionBody,
  serializeMentionedUserIds,
} from './storeChatMentions';

function store(id: string): Store {
  return {
    id,
    code: id,
    name: id,
    address: '',
    area: '',
    lat: 0,
    lng: 0,
    geofenceRadiusM: 0,
    active: true,
    createdAt: '',
    updatedAt: '',
  };
}

function profile(partial: Partial<Profile> & Pick<Profile, 'userId' | 'role'>): Profile {
  return {
    id: partial.id ?? `p-${partial.userId}`,
    userId: partial.userId,
    email: partial.email ?? `${partial.userId}@ex.com`,
    displayName: partial.displayName ?? partial.userId,
    role: partial.role,
    approvalStatus: partial.approvalStatus ?? 'approved',
    approvedAt: '',
    approvedByEmail: '',
    createdAt: '',
    updatedAt: '',
    stores: partial.stores,
  };
}

describe('mentionDisplayLabel', () => {
  it('prefers displayName then email local part', () => {
    expect(mentionDisplayLabel({ displayName: 'Minh', email: 'a@b.com' })).toBe('Minh');
    expect(mentionDisplayLabel({ displayName: '  ', email: 'minh@x.com' })).toBe('minh');
  });
});

describe('buildMentionCandidates', () => {
  const s1 = store('s1');
  const s2 = store('s2');

  it('includes assigned staff and all-store roles; excludes sender and pending', () => {
    const profiles = [
      profile({ userId: 'me', role: 'staff', stores: [s1] }),
      profile({ userId: 'u1', role: 'staff', stores: [s1], displayName: 'Ada' }),
      profile({ userId: 'u2', role: 'staff', stores: [s2], displayName: 'Bob' }),
      profile({ userId: 'u3', role: 'owner', displayName: 'Owner' }),
      profile({
        userId: 'u4',
        role: 'staff',
        stores: [s1],
        displayName: 'Pending',
        approvalStatus: 'pending',
      }),
    ];
    const c = buildMentionCandidates(profiles, 's1', 'me');
    expect(c.map((x) => x.userId).sort()).toEqual(['u1', 'u3']);
    expect(c.find((x) => x.userId === 'u1')?.label).toBe('Ada');
  });
});

describe('buildGroupMentionCandidates', () => {
  it('uses active members only; excludes self; sorts by label', () => {
    const c = buildGroupMentionCandidates(
      [
        {
          userId: 'me',
          profile: { userId: 'me', displayName: 'Me', email: 'me@x.com' },
        },
        {
          userId: 'u2',
          profile: { userId: 'u2', displayName: 'Zoe', email: 'z@x.com' },
        },
        {
          userId: 'u1',
          profile: { userId: 'u1', displayName: 'Ada', email: 'a@x.com' },
        },
      ],
      'me',
    );
    expect(c.map((x) => x.userId)).toEqual(['u1', 'u2']);
    expect(c[0]?.label).toBe('Ada');
  });
});

describe('getActiveMentionQuery / insertMentionToken', () => {
  it('detects @query at caret and rejects mid-word @', () => {
    expect(getActiveMentionQuery('hi @Mi', 6)).toEqual({ start: 3, query: 'Mi' });
    expect(getActiveMentionQuery('hi @', 4)).toEqual({ start: 3, query: '' });
    expect(getActiveMentionQuery('email@x', 7)).toBeNull();
    // Caret after a space inside the would-be token closes the active query.
    expect(getActiveMentionQuery('hi @Ada more', 8)).toBeNull();
  });

  it('inserts token replacing the active @query', () => {
    const result = insertMentionToken('hi @Mi', 6, 'Minh');
    expect(result).toEqual({ text: 'hi @Minh ', caret: 9 });
  });
});

describe('filterMentionCandidates / buildMentionMenuItems', () => {
  const candidates = [
    {
      userId: 'u1',
      label: 'Ada Lovelace',
      email: 'ada@ex.com',
      profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com', userId: 'u1' },
    },
    {
      userId: 'u2',
      label: 'Bob',
      email: 'bob@ex.com',
      profile: { displayName: 'Bob', email: 'bob@ex.com', userId: 'u2' },
    },
  ];

  it('filters by label/email', () => {
    expect(filterMentionCandidates(candidates, 'lov').map((c) => c.userId)).toEqual(['u1']);
    expect(filterMentionCandidates(candidates, 'bob@').map((c) => c.userId)).toEqual(['u2']);
  });

  it('puts @all first when query matches', () => {
    const items = buildMentionMenuItems(candidates, 'a');
    expect(items[0]).toEqual({ kind: 'all', label: 'all' });
    expect(items.some((i) => i.kind === 'user' && i.candidate.userId === 'u1')).toBe(true);
  });

  it('hides @all when query does not match', () => {
    const items = buildMentionMenuItems(candidates, 'bob');
    expect(items.every((i) => i.kind !== 'all')).toBe(true);
  });
});

describe('resolveMentionPayload / expandMentionRecipients', () => {
  const candidates = [
    {
      userId: 'u1',
      label: 'Ada',
      email: 'ada@ex.com',
      profile: { displayName: 'Ada', email: 'ada@ex.com', userId: 'u1' },
    },
    {
      userId: 'u2',
      label: 'Bob',
      email: 'bob@ex.com',
      profile: { displayName: 'Bob', email: 'bob@ex.com', userId: 'u2' },
    },
  ];

  it('resolves tracked and uniquely pasted names; detects @all', () => {
    const payload = resolveMentionPayload(
      'Hey @Ada and @all',
      [{ userId: 'u1', label: 'Ada' }],
      false,
      candidates,
    );
    expect(payload.mentionAll).toBe(true);
    expect(payload.mentionedUserIds).toEqual(['u1']);
  });

  it('keeps mention resolution stable with reply-style text prefix', () => {
    const payload = resolveMentionPayload(
      '> Alice said hello\n@Ada got it',
      [{ userId: 'u1', label: 'Ada' }],
      false,
      candidates,
    );
    expect(payload.mentionAll).toBe(false);
    expect(payload.mentionedUserIds).toEqual(['u1']);
  });

  it('expands @all to all candidates except sender', () => {
    const ids = expandMentionRecipients([], true, candidates, 'me');
    expect(ids.sort()).toEqual(['u1', 'u2']);
  });

  it('dedupes individual + @all and never includes sender', () => {
    const ids = expandMentionRecipients(['u1', 'me'], true, candidates, 'me');
    expect(ids.sort()).toEqual(['u1', 'u2']);
  });
});

describe('segmentMentionBody', () => {
  const candidates = [
    {
      userId: 'u1',
      label: 'Ada Lovelace',
      email: 'ada@ex.com',
      profile: { displayName: 'Ada Lovelace', email: 'ada@ex.com', userId: 'u1' },
    },
  ];

  it('splits into safe text/mention segments', () => {
    const segs = segmentMentionBody('Hi @Ada Lovelace / @all!', ['u1'], true, candidates);
    expect(segs).toEqual([
      { type: 'text', value: 'Hi ' },
      { type: 'mention', value: '@Ada Lovelace', userId: 'u1', isAll: false },
      { type: 'text', value: ' / ' },
      { type: 'mention', value: '@all', isAll: true, userId: undefined },
      { type: 'text', value: '!' },
    ]);
  });

  it('leaves unknown @tokens as plain text when not mentioned', () => {
    const segs = segmentMentionBody('Hi @Nobody', [], false, candidates);
    expect(segs).toEqual([{ type: 'text', value: 'Hi @Nobody' }]);
  });
});

describe('mentionedUserIdsJson helpers', () => {
  it('round-trips and tolerates bad JSON', () => {
    expect(serializeMentionedUserIds(['a', 'a', ''])).toBe('["a"]');
    expect(parseMentionedUserIdsJson('["a","b"]')).toEqual(['a', 'b']);
    expect(parseMentionedUserIdsJson('nope')).toEqual([]);
    expect(parseMentionedUserIdsJson(undefined)).toEqual([]);
  });
});
