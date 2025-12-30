'use client';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { getIdTokenResult, onAuthStateChanged } from 'firebase/auth';
import { useAuth } from '../provider';

export const useUser = () => {
  const auth = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null | undefined>(
    undefined
  );

  useEffect(() => {
    if (!auth) {
      setLoading(false);
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
