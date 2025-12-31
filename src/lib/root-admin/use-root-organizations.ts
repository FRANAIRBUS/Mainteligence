'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type FirestoreError,
} from 'firebase/firestore';
import { useFirestore } from '../firebase/provider';
import type { RootOrganization } from './types';
import { useRootAccess } from './use-root-access';

export function useRootOrganizations() {
  const firestore = useFirestore();
  const { isRoot, loading: rootLoading } = useRootAccess();
  const [data, setData] = useState<RootOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!firestore || rootLoading) {
      setLoading(true);
      setError(null);
      setData([]);
      return;
    }

    if (!isRoot) {
      setLoading(false);
      setError(new Error('Acceso root requerido'));
      setData([]);
      return;
    }

    const collectionQuery = query(
      collection(firestore, 'organizations'),
      orderBy('createdAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      collectionQuery,
      (snapshot) => {
        const organizations = snapshot.docs.map(
          (docSnap) =>
            ({
              id: docSnap.id,
              ...docSnap.data(),
            }) as RootOrganization,
        );

        setData(organizations);
        setLoading(false);
        setError(null);
      },
      (snapshotError: FirestoreError) => {
        setError(snapshotError);
        setLoading(false);
        setData([]);
      },
    );

    return () => unsubscribe();
  }, [firestore, isRoot, rootLoading]);

  return { data, loading, error };
}
