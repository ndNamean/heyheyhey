/**
 * Match a normalized public IP to an active store Wi-Fi IP row.
 */

import { normalizePublicIp } from './ip-normalize.js';

/**
 * @param {string | null | undefined} publicIp
 * @param {Array<{ id: string, storeId: string, publicIp: string, active: boolean }>} wifiIps
 * @param {Map<string, { id: string, active?: boolean, code?: string }> | Record<string, { id: string, active?: boolean, code?: string }> | null} [storesById]
 * @returns {{ wifiIp: object, store: object | null } | null}
 */
export function findMatchingActiveWifiIp(publicIp, wifiIps, storesById = null) {
  const normalized = normalizePublicIp(publicIp);
  if (!normalized) return null;

  const getStore = (storeId) => {
    if (!storesById) return null;
    if (storesById instanceof Map) return storesById.get(storeId) ?? null;
    return storesById[storeId] ?? null;
  };

  for (const row of wifiIps ?? []) {
    if (!row?.active) continue;
    if (normalizePublicIp(row.publicIp) !== normalized) continue;

    const store = getStore(row.storeId);
    if (store && store.active === false) continue;

    return { wifiIp: row, store };
  }
  return null;
}
