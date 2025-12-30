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
import { doc, onSnapshot } from 'firebase/firestore';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, useFirestore } from '../provider';
import type { User as UserProfile } from '../models';

type UserContextValue = {
  user: AuthUser | null;
  profile: (UserProfile & { organizationId?: string | null }) | null;
  organizationId: string | null;
  isLoaded: boolean;
  loading: boolean;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  profile: null,
  organizationId: null,
  isLoaded: false,
  loading: true,
});

const PUBLIC_ROUTES = ['/login', '/onboarding', '/error'];

export function UserProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const firestore = useFirestore();
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<
    (UserProfile & { organizationId?: string | null }) | null
  >(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [criticalError, setCriticalError] = useState<Error | null>(null);

  useEffect(() => {
    if (!auth) {
      setUser(null);
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [auth]);

  useEffect(() => {
    if (!firestore || !user) {
      setProfile(null);
      setProfileReady(true);
      return;
    }

    setProfileReady(false);
    const userRef = doc(firestore, `users/${user.uid}`);

    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setProfile({ id: snapshot.id, ...snapshot.data() } as UserProfile & {
            organizationId?: string | null;
          });
        } else {
          setProfile(null);
        }
        setProfileReady(true);
      },
      () => {
        setProfile(null);
        setProfileReady(true);
      }
    );

    return () => unsubscribe();
  }, [firestore, user]);

  const organizationId = profile?.organizationId ?? null;
  const isLoaded = useMemo(
    () => authReady && (!user || profileReady),
    [authReady, profileReady, user]
  );

  const isProtectedRoute = useMemo(
    () => !PUBLIC_ROUTES.some((route) => pathname.startsWith(route)),
    [pathname]
  );

  useEffect(() => {
    if (!isLoaded || !user || !isProtectedRoute) return;

    if (!organizationId) {
      router.replace('/onboarding');
      setCriticalError(new Error('Critical: Missing organizationId in transaction'));
    }
  }, [isLoaded, isProtectedRoute, organizationId, router, user]);

  if (criticalError) {
    throw criticalError;
  }

  const value = useMemo(
    () => ({
      user,
      profile,
      organizationId,
      isLoaded,
      loading: !isLoaded,
    }),
    [user, profile, organizationId, isLoaded]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export const useUser = () => useContext(UserContext);
