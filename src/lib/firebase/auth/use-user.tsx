'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useAuth, useFirestore, useFirebaseApp } from '@/lib/firebase/provider';
import { Membership, UserProfile } from '@/lib/firebase/models';

type UserContextType = {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  memberships: Membership[];
  organizationId: string | null;
  activeMembership: Membership | null;
  role: string | null;
  isRoot: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isMaintenance: boolean;
  loading: boolean;
  error: string | null;
  setActiveOrganizationId: (orgId: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const UserContext = createContext<UserContextType>({
  user: null,
  profile: null,
  memberships: [],
  organizationId: null,
  activeMembership: null,
  role: null,
  isRoot: false,
  isSuperAdmin: false,
  isAdmin: false,
  isMaintenance: false,
  loading: true,
  error: null,
  setActiveOrganizationId: async () => {},
  refreshProfile: async () => {},
});

function mapMembership(snap: QueryDocumentSnapshot<DocumentData>): Membership {
  const d = snap.data() as any;
  return {
    id: snap.id,
    organizationId: String(d.organizationId ?? ''),
    organizationName: d.organizationName ?? null,
    userId: String(d.userId ?? ''),
    role: String(d.role ?? 'operator'),
    status: String(d.status ?? (d.active === true ? 'active' : 'pending')),
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
    source: d.source ?? null,
    primary: Boolean(d.primary ?? false),
  } as any;
}

function pickDefaultOrgId(opts: {
  preferredOrgId: string | null;
  profileOrgId: string | null;
  memberships: Membership[];
}): string | null {
  const { preferredOrgId, profileOrgId, memberships } = opts;

  const active = memberships.filter((m) => m.status === 'active' && m.organizationId);
  const pending = memberships.filter((m) => m.status !== 'active' && m.organizationId);

  if (preferredOrgId) {
    const hit = active.find((m) => m.organizationId === preferredOrgId);
    if (hit) return hit.organizationId;
  }

  if (profileOrgId) {
    const hit = active.find((m) => m.organizationId === profileOrgId);
    if (hit) return hit.organizationId;

    const pend = pending.find((m) => m.organizationId === profileOrgId);
    if (pend) return pend.organizationId;
  }

  if (active.length > 0) return active[0].organizationId;
  if (pending.length > 0) return pending[0].organizationId;

  return null;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const app = useFirebaseApp();
  const auth = useAuth();
  const firestore = useFirestore();

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [activeMembership, setActiveMembership] = useState<Membership | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isRoot, setIsRoot] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = async () => {
    if (!user || !firestore) return;
    const profileRef = doc(firestore, 'users', user.uid);
    const snap = await getDoc(profileRef);
    setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
  };

  // Auth subscription
  useEffect(() => {
    if (!auth) return;

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(true);
      setError(null);
      if (u) {
        u.getIdTokenResult()
          .then((r) => setIsRoot(Boolean((r?.claims as any)?.root) || (r?.claims as any)?.role === 'root'))
          .catch(() => setIsRoot(false));
      } else {
        setIsRoot(false);
      }
      if (!u) {
        setProfile(null);
        setMemberships([]);
        setOrganizationId(null);
        setActiveMembership(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => unsub();
  }, [auth]);

  // Profile subscription
  useEffect(() => {
    if (!user || !firestore) return;
    const profileRef = doc(firestore, 'users', user.uid);

<<<<<<< HEAD
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
=======
    const unsub = onSnapshot(
      profileRef,
      (snap) => {
        if (!snap.exists()) {
          // IMPORTANT: do not auto-create org/profile client-side.
          setProfile(null);
          setError(null);
          return;
        }
        setProfile(snap.data() as UserProfile);
      },
      (err) => setError(err?.message ?? 'Error leyendo perfil')
>>>>>>> 3633724 (fix: Mainteligence-staging_multi_users_panel)
    );

    return () => unsub();
  }, [user, firestore]);

  // Memberships subscription (across orgs)
  useEffect(() => {
    if (!user || !firestore) return;

    const membershipsRef = collection(firestore, 'memberships');
    const q = query(membershipsRef, where('userId', '==', user.uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map(mapMembership);
        setMemberships(items);
      },
      (err) => setError(err?.message ?? 'Error leyendo membresías')
    );

<<<<<<< HEAD
    return () => unsubscribe();
  }, [firestore, user, isRoot, profile?.organizationId]);
=======
    return () => unsub();
  }, [user, firestore]);
>>>>>>> 3633724 (fix: Mainteligence-staging_multi_users_panel)

  // Derive active org / active membership / role
  useEffect(() => {
    if (!user) return;

    const preferredOrgId =
      typeof window !== 'undefined' ? window.localStorage.getItem('preferredOrganizationId') : null;

    const nextOrgId = pickDefaultOrgId({
      preferredOrgId,
      profileOrgId: (profile as any)?.organizationId ?? null,
      memberships,
    });

    setOrganizationId((prev) => (prev === nextOrgId ? prev : nextOrgId));

    const am = nextOrgId ? memberships.find((m) => m.organizationId === nextOrgId) ?? null : null;
    setActiveMembership(am);

    const derivedRole = am?.status === 'active' ? (am.role ?? 'operator') : ((profile as any)?.role ?? 'operator');
    setRole(derivedRole);

    setLoading(false);
  }, [user, profile, memberships]);

  const setActiveOrganizationId = async (orgId: string) => {
    const next = String(orgId ?? '').trim();
    if (!next) return;

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('preferredOrganizationId', next);
    }

    setOrganizationId(next);

    // Persist server-side (optional, but useful across devices)
    try {
      if (!app) return;
      const fn = httpsCallable(getFunctions(app), 'setActiveOrganization');
      await fn({ organizationId: next });
    } catch {
      // If membership is pending or function unavailable, we keep local selection only.
    }
  };

  const value = useMemo<UserContextType>(
    () => ({
      user,
      profile,
      memberships,
      organizationId,
      activeMembership,
      role,
      isRoot,
      isSuperAdmin: !isRoot && role === 'super_admin',
      isAdmin: !isRoot && (role === 'admin' || role === 'super_admin'),
      isMaintenance: !isRoot && role === 'maintenance',
      loading,
      error,
      setActiveOrganizationId,
      refreshProfile,
    }),
    [user, profile, memberships, organizationId, activeMembership, role, isRoot, loading, error]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
