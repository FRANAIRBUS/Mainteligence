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
import { normalizeRole } from '@/lib/rbac';

interface UserContextValue {
  user: AuthUser | null;
  profile: UserProfile | null;
  organizationId: string | null;
  memberships: Membership[];
  activeMembership: Membership | null;
  role:
    | 'root'
    | 'super_admin'
    | 'admin'
    | 'maintenance'
    | 'dept_head_multi'
    | 'dept_head_single'
    | 'operator';
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isMaintenance: boolean;
  isOperator: boolean;
  canAccessOrgConfig: boolean;
  /**
   * Root mode is a separate, hidden capability that is NOT an app role.
   * It is granted ONLY via Firebase Auth custom claims (token.root === true).
   * Root users:
   * - do NOT get a /users profile document
   * - do NOT get memberships
   * - are redirected to /root
   */
  isRoot: boolean;
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
  isRoot: false,
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
  const [isRoot, setIsRoot] = useState(false);
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
        setIsRoot(false);
        setProfileLoading(false);
        setMembershipsLoading(false);
        return;
      }

      // Root users are identified ONLY by a custom claim and do not participate
      // in org/membership flows.
      try {
        const token = await authUser.getIdTokenResult();
        const rootClaim = Boolean((token?.claims as any)?.root);
        setIsRoot(rootClaim);
        if (rootClaim) {
          setProfile(null);
          setMemberships([]);
          setOrganizationId(null);
          setProfileLoading(false);
          setMembershipsLoading(false);
          return;
        }
      } catch (e) {
        // If token read fails, fall back to normal flow.
        setIsRoot(false);
      }

      try {
        setProfileLoading(true);
        const profileRef = doc(firestore, 'users', authUser.uid);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
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
          const bootstrappedProfile = await ensureDefaultOrganization(
            firestore,
            authUser,
            profileData,
          );
          setProfile(bootstrappedProfile);
          setOrganizationId(bootstrappedProfile?.organizationId ?? null);
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
    if (!firestore || !user || isRoot) {
      setMemberships([]);
      setMembershipsLoading(false);
      return;
    }

    // Firestore security rules require queries to be scoped to the caller's organization.
    // Wait until the profile is loaded so we can constrain the query accordingly.
    const organizationFilterId = profile?.organizationId;
    if (!organizationFilterId) {
      setMemberships([]);
      setMembershipsLoading(false);
      return;
    }

    setMembershipsLoading(true);
    const membershipsQuery = query(
      collection(firestore, 'memberships'),
      where('userId', '==', user.uid),
      where('organizationId', '==', organizationFilterId),
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
  }, [firestore, user, isRoot, profile?.organizationId]);

  useEffect(() => {
    if (!authResolved) {
      return;
    }

    if (isRoot) {
      setOrganizationId(null);
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
    const isLoaded = (organizationId !== undefined && !loading) || (isRoot && authResolved);

    
    const roleRaw = (profile?.role ?? activeMembership?.role ?? 'operator') as any;
    const normalizedRole = normalizeRole(roleRaw) ?? 'operator';
    const role =
      normalizedRole === 'super_admin'
        ? 'super_admin'
        : normalizedRole === 'admin'
          ? 'admin'
          : normalizedRole === 'maintenance'
            ? 'maintenance'
            : normalizedRole === 'dept_head_multi'
              ? 'dept_head_multi'
              : normalizedRole === 'dept_head_single'
                ? 'dept_head_single'
                : 'operator';

    const isSuperAdmin = role === 'super_admin';
    const isAdmin = role === 'admin' || isSuperAdmin;
    const isMaintenance = role === 'maintenance';
    const isOperator = role === 'operator';
    const canAccessOrgConfig = isSuperAdmin;

    return {
      user,
      profile,
      organizationId: resolvedOrganizationId,
      memberships,
      activeMembership,
      role,
      isSuperAdmin,
      isAdmin,
      isMaintenance,
      isOperator,
      canAccessOrgConfig,
      isRoot,
      setActiveOrganizationId,
      isLoaded,
      loading,
    };
  }, [
    organizationId,
    memberships,
    profile,
    user,
    isRoot,
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
