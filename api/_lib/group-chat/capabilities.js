/**
 * Capability helpers for Custom Group Chat Admin routes.
 */

function unwrap(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function defFor(ctx) {
  return unwrap(ctx.roleDefinition) ?? (ctx.roleDefinitions || []).find((d) => d.key === ctx.role);
}

export function roleCanCreateGroupChat(ctx) {
  const def = defFor(ctx);
  if (def && typeof def.canCreateGroupChat === 'boolean') return !!def.canCreateGroupChat;
  // Seed fallback until roleDefinitions rows are ensured.
  return ['owner', 'admin', 'areaManager', 'manager', 'leader', 'subleader'].includes(ctx.role);
}

export function roleCanCreateCrossStoreGroupChat(ctx) {
  const def = defFor(ctx);
  if (def && typeof def.canCreateCrossStoreGroupChat === 'boolean') {
    return !!def.canCreateCrossStoreGroupChat;
  }
  return ['owner', 'admin', 'areaManager', 'manager', 'leader'].includes(ctx.role);
}

export function roleCanSendGroupChat(ctx) {
  if (ctx.role === 'viewer') return false;
  const def = defFor(ctx);
  if (def && typeof def.canSendGroupChat === 'boolean') return !!def.canSendGroupChat;
  return ctx.role !== 'viewer';
}

/**
 * Invitee must share an authorized store with the actor unless cross-store is allowed.
 * Actor with canAccessAllStores may invite any approved profile when cross-store OR
 * when invitee shares any store (always ok for all-store actors).
 */
export function assertInviteeEligible(actorCtx, inviteeProfile, canCrossStore) {
  if (!inviteeProfile || inviteeProfile.approvalStatus !== 'approved') {
    return 'Invitee must be an approved profile';
  }
  if (inviteeProfile.userId === actorCtx.userId) {
    return 'Cannot invite yourself';
  }
  if (canCrossStore) return null;

  const actorStores = new Set(actorCtx.storeIds || []);
  const inviteeStores = (inviteeProfile.stores || []).map((s) => s.id);
  if (!inviteeStores.length) {
    return 'Invitee has no assigned stores';
  }
  const overlap = inviteeStores.some((id) => actorStores.has(id));
  if (!overlap) {
    return 'Forbidden: cross-store invite requires canCreateCrossStoreGroupChat';
  }
  return null;
}

export function memberIsRoomOwnerOrAdmin(member) {
  return member && (member.roomRole === 'owner' || member.roomRole === 'admin');
}
