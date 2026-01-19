'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

  // 1) User preference wins (explicit org switch from UI / persisted in localStorage)
  if (preferredOrgId) {
    const hit = active.find((m) => m.organizationId === preferredOrgId);
    if (hit) return hit.organizationId;
  }

  // 2) Primary membership is the server-side canonical default
  const primary = active.find((m) => Boolean(m.primary));
  if (primary) return primary.organizationId;

  // 3) Profile org id if it maps to an active membership
  if (profileOrgId) {
    const hit = active.find((m) => m.organizationId === profileOrgId);
    if (hit) return hit.organizationId;
  }

  // 4) Fallback: first active membership
  if (active.length > 0) return active[0].organizationId;
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

  const [profileReady, setProfileReady] = useState(false);
  const [membershipsReady, setMembershipsReady] = useState(false);
  const bootstrapAttemptedRef = useRef(false);

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
      setProfileReady(false);
      setMembershipsReady(false);
      bootstrapAttemptedRef.current = false;
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

    const unsub = onSnapshot(
      profileRef,
      (snap) => {
        setProfileReady(true);
        if (!snap.exists()) {
          // IMPORTANT: do not auto-create org/profile client-side.
          setProfile(null);
          setError(null);
          return;
        }
        setProfile(snap.data() as UserProfile);
      },
      (err) => {
        setProfileReady(true);
        setError(err?.message ?? 'Error leyendo perfil');
      }
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
        setMembershipsReady(true);
        const items = snap.docs.map(mapMembership);
        setMemberships(items);
      },
      (err) => {
        setMembershipsReady(true);
        setError(err?.message ?? 'Error leyendo membresías');
      }
    );

    return () => unsub();
  }, [user, firestore]);


  // Auto-claim pending invitations when the user logs in.
  useEffect(() => {
    if (!app || !user) return;
    if (bootstrapAttemptedRef.current) return;
    if (!profileReady || !membershipsReady) return;

    bootstrapAttemptedRef.current = true;

    (async () => {
      try {
        const fn = httpsCallable(getFunctions(app, 'us-central1'), 'bootstrapFromInvites');
        await fn({});
      } catch (err) {
        // Non-blocking: onboarding can still guide the user.
        console.warn('[bootstrapFromInvites] failed', err);
      }
    })();
  }, [app, user, profile, memberships, profileReady, membershipsReady]);

  // Derive active org / active membership / role
  useEffect(() => {
    if (!user) return;
    if (!profileReady || !membershipsReady) return;

    const preferredOrgId =
      typeof window !== 'undefined' ? window.localStorage.getItem('preferredOrganizationId') : null;

    const nextOrgId = pickDefaultOrgId({
      preferredOrgId,
      profileOrgId: (profile as any)?.organizationId ?? null,
      memberships,
    });

    setOrganizationId((prev) => (prev === nextOrgId ? prev : nextOrgId));

    const nextMembership =
      nextOrgId ? memberships.find((m) => m.organizationId === nextOrgId) ?? null : null;
    setActiveMembership(nextMembership);

    const derivedRole = nextMembership?.status === 'active' ? (nextMembership.role ?? 'operator') : null;
    setRole(derivedRole);

    setLoading(false);
  }, [user, profile, memberships, profileReady, membershipsReady]);

  const setActiveOrganizationId = async (orgId: string) => {
    const next = String(orgId ?? '').trim();
    if (!next) return;

    const targetMembership = memberships.find((membership) => membership.organizationId === next);
    if (!targetMembership || targetMembership.status !== 'active') return;

    const nextActive = memberships.find((membership) => membership.organizationId === next) ?? null;
    const derivedRole = nextActive?.status === 'active' ? (nextActive.role ?? 'operator') : null;

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('preferredOrganizationId', next);
    }

    setOrganizationId(next);
    setActiveMembership(nextActive);
    setRole(derivedRole);

    // Persist server-side (optional, but useful across devices)
    try {
      if (!app) return;
      const fn = httpsCallable(getFunctions(app, 'us-central1'), 'setActiveOrganization');
      await fn({ organizationId: next });
    } catch {
      // Non-blocking: local selection already set.
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
