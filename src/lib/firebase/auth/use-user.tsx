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
import { doc, getDoc } from 'firebase/firestore';
import { useAuth, useFirestore } from '../provider';
import type { User as UserProfile } from '../models';

interface UserContextValue {
  user: AuthUser | null;
  profile: UserProfile | null;
  organizationId: string | null;
  isLoaded: boolean;
  loading: boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  profile: null,
  organizationId: null,
  isLoaded: false,
  loading: true,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const firestore = useFirestore();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth || !firestore) {
      setUser(null);
      setProfile(null);
      setOrganizationId(undefined);
      setLoading(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);

      if (!authUser) {
        setProfile(null);
        setOrganizationId(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const profileRef = doc(firestore, 'users', authUser.uid);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
          setProfile(null);
          setOrganizationId(null);
          setLoading(false);
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
        setOrganizationId(profileData.organizationId);
      } catch (error) {
        console.error('[UserProvider] Failed to resolve user profile', error);
        setProfile(null);
        setOrganizationId(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [auth, firestore]);

  const value = useMemo<UserContextValue>(() => {
    const resolvedOrganizationId = organizationId ?? null;
    const isLoaded = organizationId !== undefined && !loading;

    return {
      user,
      profile,
      organizationId: resolvedOrganizationId,
      isLoaded,
      loading,
    };
  }, [loading, organizationId, profile, user]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export const useUser = () => useContext(UserContext);
