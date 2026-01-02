'use client';
import { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  QueryConstraint,
  query,
  where,
} from 'firebase/firestore';
import { useFirestore } from '../provider';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';
import { useUser } from '../auth/use-user';
import { normalizeRole } from '@/lib/rbac';

export function useCollection<T>(path: string | null, ...queries: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();
  const { user, loading: userLoading, organizationId, profile } = useUser();
  const normalizedRole = normalizeRole(profile?.role);
  const allowCrossOrg = false; // Always scope to active organizationId

  useEffect(() => {
    try {
      if (!path) {
        setLoading(false);
        setData([]);
        setError(null);
        return;
      }

      if (!db || userLoading || organizationId === undefined) {
        setLoading(true);
        setData([]);
        setError(null);
        return;
      }

      if (!user) {
        setLoading(false);
        setData([]);
        setError(null);
        return;
      }

      if (organizationId === null && !allowCrossOrg) {
        const organizationError = new Error('Critical: Missing organizationId in transaction');
        setError(organizationError);
        setData([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const orgScope = allowCrossOrg ? [] : [where('organizationId', '==', organizationId)];
      const collectionQuery = query(
        collection(db, path),
        ...orgScope,
        ...queries
      );

      const unsubscribe = onSnapshot(
        collectionQuery,
        (snapshot) => {
          try {
            const newData = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            })) as T[];
            setData(newData);
            setLoading(false);
            setError(null);
          } catch (snapshotError) {
            setError(snapshotError as Error);
            setData([]);
            setLoading(false);
          }
        },
        (err) => {
          if (err.code === 'permission-denied') {
            const permissionError = new FirestorePermissionError({
              path,
              operation: 'list',
            });
            errorEmitter.emit('permission-error', permissionError);
          }
          console.error(`Error fetching collection ${path}:`, err);
          setError(err);
          setData([]);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      setError(err as Error);
      setData([]);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowCrossOrg, db, path, user, userLoading, organizationId, ...queries]);

  return { data, loading, error };
}

export function useCollectionQuery<T>(
  path: string | null,
  ...queries: QueryConstraint[]
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();
  const { user, loading: userLoading, organizationId, profile } = useUser();
  const normalizedRole = normalizeRole(profile?.role);
  const allowCrossOrg = false; // Always scope to active organizationId

  useEffect(() => {
    try {
      if (!path) {
        setLoading(false);
        setData([]);
        setError(null);
        return;
      }

      if (!db || userLoading || organizationId === undefined) {
        setLoading(true);
        setData([]);
        setError(null);
        return;
      }

      if (!user) {
        setLoading(false);
        setData([]);
        setError(null);
        return;
      }

      if (organizationId === null && !allowCrossOrg) {
        const organizationError = new Error('Critical: Missing organizationId in transaction');
        setError(organizationError);
        setData([]);
        setLoading(false);
        return;
      }

      const orgScope = allowCrossOrg ? [] : [where('organizationId', '==', organizationId)];
      const preparedQuery = query(
        collection(db, path),
        ...orgScope,
        ...queries
      );

      setLoading(true);
      const unsubscribe = onSnapshot(
        preparedQuery,
        (snapshot) => {
          try {
            const newData = snapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data(),
            })) as T[];
            setData(newData);
            setLoading(false);
            setError(null);
          } catch (snapshotError) {
            setError(snapshotError as Error);
            setData([]);
            setLoading(false);
          }
        },
        (err) => {
          if (err.code === 'permission-denied') {
            const permissionError = new FirestorePermissionError({
              path,
              operation: 'list',
            });
            errorEmitter.emit('permission-error', permissionError);
          }
          console.error(`Error executing query:`, err);
          setError(err);
          setData([]);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      setError(err as Error);
      setData([]);
      setLoading(false);
    }
  }, [allowCrossOrg, db, organizationId, path, user, userLoading, ...queries]);

  return { data, loading, error };
}
