import { describe, expect, it } from 'vitest';
import { canFinalApproveAccess } from './roles';

describe('canFinalApproveAccess', () => {
  it('allows owner, admin, and areaManager only', () => {
    expect(canFinalApproveAccess('owner')).toBe(true);
    expect(canFinalApproveAccess('admin')).toBe(true);
    expect(canFinalApproveAccess('areaManager')).toBe(true);
  });

  it('denies manager and below', () => {
    expect(canFinalApproveAccess('manager')).toBe(false);
    expect(canFinalApproveAccess('leader')).toBe(false);
    expect(canFinalApproveAccess('staff')).toBe(false);
  });
});
