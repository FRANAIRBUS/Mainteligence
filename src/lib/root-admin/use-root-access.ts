'use client';

import { useEffect, useMemo, useState } from 'react';
import { getIdTokenResult, onIdTokenChanged } from 'firebase/auth';
import { useAuth } from '../firebase/provider';
import { useUser } from '../firebase';

const parseAllowlist = () =>
  (process.env.NEXT_PUBLIC_ROOT_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export function useRootAccess() {
  const auth = useAuth();
  const { user, loading: userLoading } = useUser();
  const [loading, setLoading] = useState(true);
  const [isRoot, setIsRoot] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const allowlistedEmails = useMemo(() => new Set(parseAllowlist()), []);

  useEffect(() => {
    if (!auth || userLoading) {
      setLoading(true);
      setIsRoot(false);
      setError(null);
      return;
    }

    if (!user) {
      setLoading(false);
      setIsRoot(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const unsubscribe = onIdTokenChanged(auth, async (authUser) => {
      if (!authUser) {
        setIsRoot(false);
        setLoading(false);
        return;
      }

      try {
        const token = await getIdTokenResult(authUser, true);
        const roles = (token.claims.roles as string[] | undefined) ?? [];
        const claimRole = (token.claims.role as string | undefined)?.toLowerCase();
        const hasRootClaim =
          token.claims.root === true || claimRole === 'root' || roles.includes('root');
        const isAllowlisted =
          !!authUser.email && allowlistedEmails.has(authUser.email.toLowerCase());

        setIsRoot(hasRootClaim || isAllowlisted);
        setLoading(false);
      } catch (tokenError) {
        setIsRoot(false);
        setError(tokenError as Error);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [allowlistedEmails, auth, user, userLoading]);

  return { isRoot, loading, error };
}
