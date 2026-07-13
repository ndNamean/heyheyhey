import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { db } from '../db';
import {
  useRoleDefinitionsQuery,
  useSeedRoleDefinitions,
  linkProfilesToRoleDefinitions,
} from '../lib/roleResolver';
import type { Profile, RoleDefinition } from '../types';

interface RoleDefinitionsContextValue {
  defs: RoleDefinition[];
  isLoading: boolean;
}

const RoleDefinitionsContext = createContext<RoleDefinitionsContextValue>({
  defs: [],
  isLoading: true,
});

function useLinkProfilesToDefinitions(
  isOwner: boolean,
  defs: RoleDefinition[],
  profiles: { id: string; role: string }[] | undefined,
) {
  const linkedRef = useRef(false);

  useEffect(() => {
    if (!isOwner || !defs.length || !profiles?.length || linkedRef.current) return;
    const txs = linkProfilesToRoleDefinitions(profiles, defs);
    if (!txs.length) return;
    linkedRef.current = true;
    db.transact(txs).catch(() => {
      linkedRef.current = false;
    });
  }, [isOwner, defs, profiles]);
}

export function RoleDefinitionsProvider({
  profile,
  children,
}: {
  profile: Profile;
  children: ReactNode;
}) {
  const { defs, isLoading, isEmpty } = useRoleDefinitionsQuery();
  const isOwner = profile.role === 'owner';

  useSeedRoleDefinitions(isOwner, defs, isEmpty);

  const { data: profileData } = db.useQuery(
    isOwner ? { profiles: {} } : null,
  );
  useLinkProfilesToDefinitions(isOwner, defs, profileData?.profiles);

  const value = useMemo(() => ({ defs, isLoading }), [defs, isLoading]);

  return (
    <RoleDefinitionsContext.Provider value={value}>
      {children}
    </RoleDefinitionsContext.Provider>
  );
}

export function useRoleDefinitions() {
  return useContext(RoleDefinitionsContext);
}
