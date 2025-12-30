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

export function useCollection<T>(path: string | null, ...queries: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();
  const { user, loading: userLoading, organizationId } = useUser();

  useEffect(() => {
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

    if (organizationId === null) {
      const organizationError = new Error('Critical: Missing organizationId in transaction');
      setError(organizationError);
      setData([]);
      setLoading(false);
      throw organizationError;
    }

    setLoading(true);
    const collectionQuery = query(
      collection(db, path),
      where('organizationId', '==', organizationId),
      ...queries
    );

    const unsubscribe = onSnapshot(
      collectionQuery,
      (snapshot) => {
        const newData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];
        setData(newData);
        setLoading(false);
        setError(null);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, path, user, userLoading, organizationId, ...queries]);

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
  const { user, loading: userLoading, organizationId } = useUser();

  useEffect(() => {
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

    if (organizationId === null) {
      const organizationError = new Error('Critical: Missing organizationId in transaction');
      setError(organizationError);
      setData([]);
      setLoading(false);
      throw organizationError;
    }

    const preparedQuery = query(
      collection(db, path),
      where('organizationId', '==', organizationId),
      ...queries
    );

    setLoading(true);
    const unsubscribe = onSnapshot(
      preparedQuery,
      (snapshot) => {
        const newData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];
        setData(newData);
        setLoading(false);
        setError(null);
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
  }, [db, organizationId, path, user, userLoading, ...queries]);

  return { data, loading, error };
}
