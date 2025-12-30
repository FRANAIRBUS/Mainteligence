'use client';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { getIdTokenResult, onAuthStateChanged } from 'firebase/auth';
import { useAuth } from '../provider';

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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null | undefined>(
    undefined
  );

  useEffect(() => {
    if (!auth) {
      setUser(null);
      setAuthReady(true);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);

      if (!user) {
        setOrganizationId(null);
        setLoading(false);
        return;
      }

      try {
        const idTokenResult = await getIdTokenResult(user);
        setOrganizationId(
          (idTokenResult.claims.organizationId as string | undefined) ?? null
        );
      } catch (error) {
        console.error('Error fetching ID token claims:', error);
        setOrganizationId(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [auth]);

  return { user, loading, organizationId };
};
