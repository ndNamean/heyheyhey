import { useEffect, useMemo, useState } from 'react';
import { db } from '../../db';
import type { Profile, Store } from '../../types';

const STORE_STORAGE_KEY = 'floatingAssistant.selectedStoreId';

function readStoredStoreId(): string {
  try {
    return localStorage.getItem(STORE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredStoreId(storeId: string) {
  try {
    if (storeId) localStorage.setItem(STORE_STORAGE_KEY, storeId);
    else localStorage.removeItem(STORE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function profileStoreIds(profile: Profile): string[] {
  return (profile.stores ?? []).map((s) => s.id);
}

/**
 * Matches Instant `hasAllStoreChatAccess` (owner | admin | areaManager).
 * Do not rely on roleDefinition canAccessAllStores alone — Instant ignores custom defs.
 */
export function hasAllStoreChatAccess(role: Profile['role']): boolean {
  return role === 'owner' || role === 'admin' || role === 'areaManager';
}

/**
 * Authorized active stores for Store Chat / Knowledge context.
 * Revalidates when profile, defs, or store list changes.
 */
export function useAuthorizedChatStores(profile: Profile) {
  const allStoresAccess = hasAllStoreChatAccess(profile.role);

  const { data, isLoading } = db.useQuery(
    allStoresAccess ? { stores: {} } : null,
  );

  const authorizedStores = useMemo(() => {
    const ids = profileStoreIds(profile);
    const source: Store[] = allStoresAccess
      ? ((data?.stores ?? []) as Store[])
      : ((profile.stores ?? []) as Store[]);

    return source
      .filter((s) => {
        if (!s.active) return false;
        if (allStoresAccess) return true;
        return ids.includes(s.id);
      })
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  }, [allStoresAccess, data?.stores, profile]);

  const [selectedStoreId, setSelectedStoreIdState] = useState(() => readStoredStoreId());

  useEffect(() => {
    if (!authorizedStores.length) {
      if (selectedStoreId) {
        setSelectedStoreIdState('');
        writeStoredStoreId('');
      }
      return;
    }

    const stillValid = authorizedStores.some((s) => s.id === selectedStoreId);
    if (stillValid) return;

    const stored = readStoredStoreId();
    const fromStorage = authorizedStores.find((s) => s.id === stored);
    const next = fromStorage?.id ?? authorizedStores[0]!.id;
    setSelectedStoreIdState(next);
    writeStoredStoreId(next);
  }, [authorizedStores, selectedStoreId]);

  const selectedStore = useMemo(
    () => authorizedStores.find((s) => s.id === selectedStoreId) ?? null,
    [authorizedStores, selectedStoreId],
  );

  function setSelectedStoreId(storeId: string) {
    if (!authorizedStores.some((s) => s.id === storeId)) return;
    setSelectedStoreIdState(storeId);
    writeStoredStoreId(storeId);
  }

  return {
    authorizedStores,
    selectedStoreId,
    selectedStore,
    setSelectedStoreId,
    isLoading: allStoresAccess ? isLoading : false,
    allStoresAccess,
  };
}
