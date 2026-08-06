import { describe, expect, it } from 'vitest';
import { resolveActorProfileId } from './resolve-actor-profile-id.js';

describe('resolveActorProfileId', () => {
  const profiles = [
    { id: 'prof-a', userId: 'user-a' },
    { id: 'prof-b', userId: 'user-b' },
  ];

  it('prefers actor.profileId over profiles lookup', () => {
    expect(
      resolveActorProfileId(
        { profileId: 'prof-direct', userId: 'user-a' },
        profiles,
      ),
    ).toBe('prof-direct');
  });

  it('trims actor.profileId', () => {
    expect(resolveActorProfileId({ profileId: '  prof-x  ' }, [])).toBe(
      'prof-x',
    );
  });

  it('falls back to profiles match by userId when profileId missing', () => {
    expect(
      resolveActorProfileId({ userId: 'user-b', profileId: '' }, profiles),
    ).toBe('prof-b');
    expect(resolveActorProfileId({ userId: 'user-a' }, profiles)).toBe(
      'prof-a',
    );
  });

  it('returns empty when neither profileId nor matching profile exists', () => {
    expect(resolveActorProfileId({ userId: 'unknown' }, profiles)).toBe('');
    expect(resolveActorProfileId({}, profiles)).toBe('');
    expect(resolveActorProfileId(null, profiles)).toBe('');
    expect(resolveActorProfileId({ profileId: '   ' }, [])).toBe('');
  });

  it('ignores profiles without id', () => {
    expect(
      resolveActorProfileId({ userId: 'user-a' }, [{ userId: 'user-a' }]),
    ).toBe('');
  });
});
