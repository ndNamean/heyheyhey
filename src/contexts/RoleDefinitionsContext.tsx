import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { db } from '../db';
import {
  useRoleDefinitionsQuery,
  useSeedRoleDefinitions,
  linkProfilesToRoleDefinitions,
  transactProfileRoleDefinitionLinks,
} from '../lib/roleResolver';
import { canFinalApproveAccess } from '../lib/roles';
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
  canLink: boolean,
  defs: RoleDefinition[],
  profiles: { id: string; role: string; roleDefinition?: { id: string; key?: string } | null }[] | undefined,
) {
  const linkedRef = useRef(false);

  useEffect(() => {
    if (!canLink || !defs.length || !profiles?.length || linkedRef.current) return;
    const txs = linkProfilesToRoleDefinitions(profiles, defs);
    if (!txs.length) return;
    linkedRef.current = true;
    void transactProfileRoleDefinitionLinks(txs).catch((err) => {
      linkedRef.current = false;
      console.error('Failed to link profiles to role definitions:', err);
    });
  }, [canLink, defs, profiles]);
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
  // Instant profiles.link.roleDefinition is isAdmin (owner | admin | areaManager).
  const canLinkRoleDefinitions = canFinalApproveAccess(profile.role);

  useSeedRoleDefinitions(isOwner, defs, isEmpty);

  const { data: profileData } = db.useQuery(
    canLinkRoleDefinitions ? { profiles: { roleDefinition: {} } } : null,
  );
  useLinkProfilesToDefinitions(canLinkRoleDefinitions, defs, profileData?.profiles);

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
