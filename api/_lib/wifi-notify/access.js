/**
 * Store access + master capability checks for wifi-notify / push APIs.
 */

import { unwrapLinkedEntity } from '../export/role-capabilities.js';
import { roleCanAccessAllStores } from '../export/invite-scope.js';

export function roleCanEditMaster(role, roleDefinition, allDefs) {
  const def =
    unwrapLinkedEntity(roleDefinition) ??
    (allDefs ?? []).find((d) => d.key === role && d.active !== false);
  if (def && typeof def.canEditMaster === 'boolean') {
    return def.canEditMaster;
  }
  return role === 'owner' || role === 'admin' || role === 'areaManager';
}

export function userHasStoreAccess(ctx, storeId) {
  if (!storeId) return false;
  if (roleCanAccessAllStores(ctx.role, ctx.roleDefinition, ctx.roleDefinitions)) {
    return true;
  }
  return (ctx.storeIds ?? []).includes(storeId);
}
