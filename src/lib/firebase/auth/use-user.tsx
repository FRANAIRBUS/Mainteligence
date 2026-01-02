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
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { useAuth, useFirestore } from '../provider';
import type { Membership, User as UserProfile } from '../models';
import { DEFAULT_ORGANIZATION_ID } from '@/lib/organization';
import { REGISTRATION_FLAG_KEY } from '@/lib/registration-flag';


function isRegistrationInProgress(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage?.getItem(REGISTRATION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

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
          // During the signup wizard we don't want to auto-bootstrap a default org/profile.
          if (isRegistrationInProgress()) {
            setProfile(null);
            setOrganizationId(null);
            setProfileLoading(false);
            return;
          }
          const bootstrappedProfile = await ensureDefaultOrganization(firestore, authUser);
          setProfile(bootstrappedProfile);
          setOrganizationId(bootstrappedProfile?.organizationId ?? null);
          setProfileLoading(false);
          return;
        }

        const profileData = {
          id: profileSnap.id,
          ...profileSnap.data(),
        } as UserProfile;

        if (!profileData.organizationId) {
          // During the signup wizard we don't want to auto-bootstrap a default org/profile.
          if (isRegistrationInProgress()) {
            setProfile(profileData);
            setOrganizationId(null);
          } else {
            const bootstrappedProfile = await ensureDefaultOrganization(
              firestore,
              authUser,
              profileData,
            );
            setProfile(bootstrappedProfile);
            setOrganizationId(bootstrappedProfile?.organizationId ?? null);
          }
          setProfileLoading(false);
          return;
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

async function ensureDefaultOrganization(
  firestore: ReturnType<typeof useFirestore>,
  authUser: AuthUser,
  existingProfile?: UserProfile | null,
) {
  if (!firestore) return null;

  const organizationId = existingProfile?.organizationId ?? DEFAULT_ORGANIZATION_ID;
  const organizationRef = doc(firestore, 'organizations', organizationId);
  const organizationPublicRef = doc(firestore, 'organizationsPublic', organizationId);
  const organizationSnapshot = await getDoc(organizationRef);

  if (!organizationSnapshot.exists()) {
    await setDoc(
      organizationRef,
      {
        organizationId,
        name: organizationId,
        subscriptionPlan: 'trial',
        isActive: true,
        settings: {
          allowGuestAccess: false,
          maxUsers: 50,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    // Minimal public doc so signup can verify org existence without leaking org list.
    await setDoc(
      organizationPublicRef,
      {
        organizationId,
        name: organizationId,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  const userRef = doc(firestore, 'users', authUser.uid);
  const defaultProfileData = {
    displayName: authUser.displayName || authUser.email || 'Usuario',
    email: authUser.email || '',
    role: existingProfile?.role ?? 'admin',
    active: true,
    isMaintenanceLead: true,
    organizationId,
    adminRequestPending: false,
    createdAt: existingProfile?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(
    userRef,
    {
      ...defaultProfileData,
    },
    { merge: true },
  );

  const membershipRef = doc(firestore, 'memberships', `${authUser.uid}_${organizationId}`);
  const membershipSnap = await getDoc(membershipRef);
  if (!membershipSnap.exists()) {
    await setDoc(
      membershipRef,
      {
        userId: authUser.uid,
        organizationId,
        organizationName:
          (organizationSnapshot.data() as { name?: string } | undefined)?.name ?? organizationId,
        role: 'admin',
        status: 'active',
        primary: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  return {
    id: userRef.id,
    ...defaultProfileData,
  } as UserProfile;
}
