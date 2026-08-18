import { describe, expect, it } from 'vitest';
import {
  linkedFileIds,
  parseSubmitFileIds,
  planResolutionMediaLinks,
} from './submit-resolution-media.js';

describe('parseSubmitFileIds', () => {
  it('fileIds of 3 wins over legacy fileId', () => {
    expect(
      parseSubmitFileIds({
        fileIds: ['a', 'b', 'c'],
        fileId: 'legacy',
      }),
    ).toEqual(['a', 'b', 'c']);
  });

  it('empty fileIds plus fileId still works', () => {
    expect(parseSubmitFileIds({ fileIds: [], fileId: 'legacy' })).toEqual([
      'legacy',
    ]);
    expect(parseSubmitFileIds({ fileId: 'legacy' })).toEqual(['legacy']);
  });

  it('trims, drops empties, and dedupes', () => {
    expect(
      parseSubmitFileIds({ fileIds: [' a ', '', 'b', 'a', '  '] }),
    ).toEqual(['a', 'b']);
  });
});

describe('linkedFileIds', () => {
  it('reads prior media as an array or a single object', () => {
    expect(
      linkedFileIds([
        { id: 'p1' },
        { id: 'p2' },
        { id: '' },
        null,
      ]),
    ).toEqual(['p1', 'p2']);
    expect(linkedFileIds({ id: 'p1' })).toEqual(['p1']);
    expect(linkedFileIds(null)).toEqual([]);
    expect(linkedFileIds(undefined)).toEqual([]);
  });
});

describe('planResolutionMediaLinks', () => {
  it('resubmit: previous current ids go to history and are unlinked; new ids become current', () => {
    expect(
      planResolutionMediaLinks({
        priorResolutionMedia: [{ id: 'old-a' }, { id: 'old-b' }],
        priorPhotoId: 'old-a',
        historyIds: new Set(['older']),
        newFileIds: ['new-1', 'new-2'],
      }),
    ).toEqual({
      unlinkResolutionMediaIds: ['old-a', 'old-b'],
      unlinkPhotoIds: ['old-a'],
      historyLinkIds: ['old-a', 'old-b', 'new-1', 'new-2'],
      currentLinkIds: ['new-1', 'new-2'],
    });
  });

  it('plans the same unlink/history lists for a legacy single-object current proof', () => {
    expect(
      planResolutionMediaLinks({
        priorResolutionMedia: { id: 'old-a' },
        priorPhotoId: 'source-photo',
        historyIds: [],
        newFileIds: ['new-1'],
      }),
    ).toEqual({
      unlinkResolutionMediaIds: ['old-a'],
      unlinkPhotoIds: [],
      historyLinkIds: ['old-a', 'new-1'],
      currentLinkIds: ['new-1'],
    });
  });

  it('skips history-link when a prior current id is already in history', () => {
    expect(
      planResolutionMediaLinks({
        priorResolutionMedia: [{ id: 'old-a' }],
        priorPhotoId: '',
        historyIds: ['old-a'],
        newFileIds: ['new-1'],
      }),
    ).toEqual({
      unlinkResolutionMediaIds: ['old-a'],
      unlinkPhotoIds: [],
      historyLinkIds: ['new-1'],
      currentLinkIds: ['new-1'],
    });
  });

  it('duplicate ids in the payload are linked once', () => {
    expect(
      planResolutionMediaLinks({
        priorResolutionMedia: [],
        priorPhotoId: '',
        historyIds: new Set(),
        newFileIds: ['a', 'a', 'b', 'a'],
      }),
    ).toEqual({
      unlinkResolutionMediaIds: [],
      unlinkPhotoIds: [],
      historyLinkIds: ['a', 'b'],
      currentLinkIds: ['a', 'b'],
    });
  });
});
