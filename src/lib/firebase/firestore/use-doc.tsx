'use client';
import { useState, useEffect } from 'react';
import {
  doc,
  onSnapshot,
  type DocumentReference,
  type DocumentData,
} from 'firebase/firestore';
import { useFirestore } from '../provider';
import { useUser } from '..';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';
import { normalizeRole } from '@/lib/rbac';

export function useDoc<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();
  const { user, loading: userLoading, organizationId, profile, isRoot } = useUser();
  const normalizedRole = normalizeRole(profile?.role);
  const allowCrossOrg = normalizedRole === 'super_admin';

  useEffect(() => {
    try {
      // If path is null, user not ready, or db not ready, we wait.
      if (!path) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      if (!db || userLoading || organizationId === undefined) {
        setLoading(true);
        setData(null);
        setError(null);
        return;
      }

      // A special case: if the path is supposed to contain a user ID but the user is logged out,
      // we shouldn't even attempt the query. This prevents errors for paths like `users/${user?.uid}`
      // when user is null. We also check for 'undefined' to catch dynamic paths that aren't ready.
      if (!user || path.includes('undefined')) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      // Root users never read tenant data via client SDK.
      if (isRoot) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      if (organizationId === null && !allowCrossOrg) {
        const organizationError = new Error('Critical: Missing organizationId in transaction');
        setError(organizationError);
        setData(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const docRef = doc(db, path);
      const unsubscribe = onSnapshot(
        docRef,
        (docSnap) => {
          try {
            if (docSnap.exists()) {
              const docData = docSnap.data() as DocumentData & { organizationId?: string };

              if (!allowCrossOrg && docData.organizationId !== organizationId) {
                const organizationError = new Error(
                  docData.organizationId
                    ? 'Critical: Organization mismatch in transaction'
                    : 'Critical: Missing organizationId in transaction',
                );

                setError(organizationError);
                setData(null);
                setLoading(false);
                return;
              }

              setData({ id: docSnap.id, ...docData } as T);
            } else {
              // Document does not exist
              setData(null);
            }
            setLoading(false);
            setError(null);
          } catch (snapshotError) {
            setError(snapshotError as Error);
            setData(null);
            setLoading(false);
          }
        },
        (err) => {
          // Handle errors, including permission errors
          if ((err as { code?: string }).code === 'permission-denied') {
            const permissionError = new FirestorePermissionError({
              path,
              operation: 'get',
            });
            errorEmitter.emit('permission-error', permissionError);
          }

          console.error(`Error fetching document ${path}:`, err);
          setError(err);
          setData(null);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      setError(err as Error);
      setData(null);
      setLoading(false);
    }
  }, [allowCrossOrg, db, organizationId, path, user, userLoading]);
  
  return { data, loading, error };
}


export function useDocRef<T>(docRef: DocumentReference | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { user, loading: userLoading, organizationId, profile } = useUser();
  const normalizedRole = normalizeRole(profile?.role);
  const allowCrossOrg = normalizedRole === 'super_admin';

  useEffect(() => {
    try {
      // If docRef is null, or user is not ready, we are not ready to fetch.
      if (!docRef || userLoading || !user || organizationId === undefined) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      if (organizationId === null && !allowCrossOrg) {
        const organizationError = new Error('Critical: Missing organizationId in transaction');
        setError(organizationError);
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const unsubscribe = onSnapshot(
        docRef,
        (docSnap) => {
          try {
            if (docSnap.exists()) {
              const docData = docSnap.data() as DocumentData & { organizationId?: string };

              if (!allowCrossOrg && docData.organizationId !== organizationId) {
                const organizationError = new Error(
                  docData.organizationId
                    ? 'Critical: Organization mismatch in transaction'
                    : 'Critical: Missing organizationId in transaction',
                );
                setError(organizationError);
                setData(null);
                setLoading(false);
                return;
              }

              setData({ id: docSnap.id, ...docData } as T);
            } else {
              setData(null);
            }
            setLoading(false);
            setError(null);
          } catch (snapshotError) {
            setError(snapshotError as Error);
            setData(null);
            setLoading(false);
          }
        },
        (err) => {
          console.error(`Error fetching document ref ${docRef.path}:`, err);
          setError(err);
          setData(null);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      setError(err as Error);
      setData(null);
      setLoading(false);
    }
  }, [allowCrossOrg, docRef, organizationId, user, userLoading]);

  return { data, loading, error };
}
