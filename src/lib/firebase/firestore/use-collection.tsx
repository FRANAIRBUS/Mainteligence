'use client';
import { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  Query,
  DocumentData,
  CollectionReference,
} from 'firebase/firestore';
import { useFirestore } from '../provider';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';
import { useUser } from '../auth/use-user';

export function useCollection<T>(pathOrRef: string | CollectionReference | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();
  const { user, loading: userLoading } = useUser();

  // Use a stable reference for the path to avoid re-running the effect unnecessarily
  const memoizedPath = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef?.path;

  useEffect(() => {
    // If the path/ref is null, user is not logged in, or firebase is not ready, we are not ready to fetch.
    if (!db || !memoizedPath || userLoading || !user) {
      setLoading(false); 
      setData([]);
      setError(null);
      return;
    }
    
    setLoading(true);

    let collectionRef: CollectionReference;
    if (typeof pathOrRef === 'string') {
      collectionRef = collection(db, pathOrRef);
    } else if (pathOrRef) {
      collectionRef = pathOrRef; 
    } else {
      setLoading(false);
      setData([]);
      return;
    }

    const unsubscribe = onSnapshot(
      collectionRef,
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
            path: collectionRef.path,
            operation: 'list',
          });
          errorEmitter.emit('permission-error', permissionError);
        }
        console.error(`Error fetching collection ${collectionRef.path}:`, err);
        setError(err);
        setData([]); // Clear data on error
        setLoading(false);
      }
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, memoizedPath, user, userLoading]);

  return { data, loading, error };
}

export function useCollectionQuery<T>(query: Query<DocumentData> | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { user, loading: userLoading } = useUser();

  useEffect(() => {
    // If the query is null, or user not ready, we are not ready to fetch.
    if (query === null || userLoading || !user) {
      setLoading(false);
      setData([]);
      setError(null);
      return;
    }
    
    setLoading(true);
    const unsubscribe = onSnapshot(
      query,
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
            path: (query as any)._query.path.segments.join('/'),
            operation: 'list',
          });
          errorEmitter.emit('permission-error', permissionError);
        }
        console.error(`Error executing query:`, err);
        setError(err);
        setData([]); // Clear data on error
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [query, user, userLoading]); // The query object itself is the dependency

  return { data, loading, error };
}
