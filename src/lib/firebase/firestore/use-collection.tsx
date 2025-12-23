'use client';
import { useState, useEffect, useMemo } from 'react';
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

export function useCollection<T>(pathOrRef: string | CollectionReference | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();

  const memoizedPath = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef?.path;

  useEffect(() => {
    // If the path is explicitly null or empty, or db is not available, do nothing.
    if (!db || !pathOrRef) {
      setData([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);

    let collectionRef: CollectionReference;
    if (typeof pathOrRef === 'string') {
      collectionRef = collection(db, pathOrRef);
    } else {
      collectionRef = pathOrRef;
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
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [db, memoizedPath]);

  return { data, loading, error };
}

export function useCollectionQuery<T>(query: Query<DocumentData> | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const queryPath = useMemo(() => query ? (query as any)._query.path.segments.join('/') : null, [query]);
  const queryFilters = useMemo(() => query ? JSON.stringify((query as any)._query.filters) : null, [query]);

  useEffect(() => {
    if (query === null) {
      setLoading(false);
      setData([]);
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
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [query, queryPath, queryFilters]);

  return { data, loading, error };
}
