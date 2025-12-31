'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User as AuthUser } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth, useFirestore } from '../provider';
import type { Membership, User as UserProfile } from '../models';

interface UserContextValue {
  user: AuthUser | null;
  profile: UserProfile | null;
  organizationId: string | null;
  memberships: Membership[];
  activeMembership: Membership | null;
  setActiveOrganizationId: (organizationId: string) => void;
  isLoaded: boolean;
  loading: boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  profile: null,
  organizationId: null,
  memberships: [],
  activeMembership: null,
  setActiveOrganizationId: () => undefined,
  isLoaded: false,
  loading: true,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const firestore = useFirestore();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null | undefined>(
    undefined,
  );
  const [profileLoading, setProfileLoading] = useState(true);
  const [membershipsLoading, setMembershipsLoading] = useState(true);
  const [authResolved, setAuthResolved] = useState(false);
  const [persistedOrgId, setPersistedOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('activeOrgId');
      setPersistedOrgId(stored);
    }
  }, []);

  useEffect(() => {
    if (!auth || !firestore) {
      setUser(null);
      setProfile(null);
      setMemberships([]);
      setOrganizationId(undefined);
      setProfileLoading(true);
      setMembershipsLoading(true);
      setAuthResolved(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);
      setAuthResolved(true);

      if (!authUser) {
        setProfile(null);
        setMemberships([]);
        setOrganizationId(null);
        setProfileLoading(false);
        setMembershipsLoading(false);
        return;
      }

      try {
        setProfileLoading(true);
        const profileRef = doc(firestore, 'users', authUser.uid);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
          setProfile(null);
          setOrganizationId(null);
          setProfileLoading(false);
          return;
        }

        const profileData = {
          id: profileSnap.id,
          ...profileSnap.data(),
        } as UserProfile;

        if (!profileData.organizationId) {
          throw new Error('Critical: Missing organizationId in transaction');
        }

        setProfile(profileData);
      } catch (error) {
        console.error('[UserProvider] Failed to resolve user profile', error);
        setProfile(null);
        setOrganizationId(null);
      } finally {
        setProfileLoading(false);
      }
    });

    return () => unsubscribe();
  }, [auth, firestore]);

  useEffect(() => {
    if (!firestore || !user) {
      setMemberships([]);
      setMembershipsLoading(false);
      return;
    }

    setMembershipsLoading(true);
    const membershipsQuery = query(
      collection(firestore, 'memberships'),
      where('userId', '==', user.uid),
      where('status', 'in', ['active', 'pending']),
    );

    const unsubscribe = onSnapshot(
      membershipsQuery,
      (snapshot) => {
        const mappedMemberships = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Membership[];
        setMemberships(mappedMemberships);
        setMembershipsLoading(false);
      },
      (err) => {
        console.error('[UserProvider] Failed to load memberships', err);
        setMemberships([]);
        setMembershipsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [firestore, user]);

  useEffect(() => {
    if (!authResolved) {
      return;
    }

    const membershipOrgIds = memberships.map((membership) => membership.organizationId);
    const profileOrgId = profile?.organizationId;
    const candidates = new Set<string>();
    if (profileOrgId) candidates.add(profileOrgId);
    membershipOrgIds.forEach((id) => candidates.add(id));

    let resolved: string | null = null;

    if (persistedOrgId && candidates.has(persistedOrgId)) {
      resolved = persistedOrgId;
    } else if (profileOrgId) {
      resolved = profileOrgId;
    } else if (membershipOrgIds.length > 0) {
      resolved = membershipOrgIds[0];
    } else if (profileLoading || membershipsLoading) {
      return;
    }

    setOrganizationId(resolved ?? null);
  }, [
    authResolved,
    memberships,
    profile,
    persistedOrgId,
    profileLoading,
    membershipsLoading,
    organizationId,
  ]);

  const setActiveOrganizationId = (orgId: string) => {
    const allowedOrgIds = new Set<string>([
      ...memberships.map((membership) => membership.organizationId),
      profile?.organizationId ?? '',
    ]);

    if (!allowedOrgIds.has(orgId)) {
      console.warn('Attempted to select unauthorized organizationId');
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('activeOrgId', orgId);
    }

    setOrganizationId(orgId);
  };

  const value = useMemo<UserContextValue>(() => {
    const resolvedOrganizationId = organizationId ?? null;
    const activeMembership =
      memberships.find((membership) => membership.organizationId === resolvedOrganizationId) || null;
    const loading =
      !authResolved || profileLoading || membershipsLoading || organizationId === undefined;
    const isLoaded = organizationId !== undefined && !loading;

    return {
      user,
      profile,
      organizationId: resolvedOrganizationId,
      memberships,
      activeMembership,
      setActiveOrganizationId,
      isLoaded,
      loading,
    };
  }, [
    organizationId,
    memberships,
    profile,
    user,
    authResolved,
    profileLoading,
    membershipsLoading,
  ]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export const useUser = () => useContext(UserContext);
