import { describe, expect, it } from 'vitest';
import { notesAnnouncementsProfilesQuery } from './NotesAnnouncementsCard';

describe('notesAnnouncementsProfilesQuery', () => {
  it('skips Instant when the parent already loaded profiles', () => {
    expect(notesAnnouncementsProfilesQuery([])).toBeNull();
    expect(notesAnnouncementsProfilesQuery([{ id: 'p1' } as never])).toBeNull();
  });

  it('loads profiles with stores and avatars when the parent did not', () => {
    expect(notesAnnouncementsProfilesQuery(undefined)).toEqual({
      profiles: { stores: {}, avatarFile: {} },
    });
    expect(notesAnnouncementsProfilesQuery(null)).toEqual({
      profiles: { stores: {}, avatarFile: {} },
    });
  });
});
