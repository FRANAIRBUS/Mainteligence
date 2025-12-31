'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type FirestoreError,
} from 'firebase/firestore';
import { useFirestore } from '../firebase/provider';
import { useRootAccess } from './use-root-access';
import type { AuditLogEntry } from './types';

export function useRootAuditLog(entryLimit = 25) {
  const firestore = useFirestore();
  const { isRoot, loading: rootLoading } = useRootAccess();
  const [data, setData] = useState<AuditLogEntry[]>([]);
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

    const auditQuery = query(
      collection(firestore, 'auditLogs'),
      orderBy('createdAt', 'desc'),
      limit(entryLimit),
    );

    const unsubscribe = onSnapshot(
      auditQuery,
      (snapshot) => {
        setData(
          snapshot.docs.map(
            (docSnap) =>
              ({
                id: docSnap.id,
                ...docSnap.data(),
              }) as AuditLogEntry,
          ),
        );
        setError(null);
        setLoading(false);
      },
      (snapshotError: FirestoreError) => {
        setError(snapshotError);
        setLoading(false);
        setData([]);
      },
    );

    return () => unsubscribe();
  }, [entryLimit, firestore, isRoot, rootLoading]);

  return { data, loading, error };
}
