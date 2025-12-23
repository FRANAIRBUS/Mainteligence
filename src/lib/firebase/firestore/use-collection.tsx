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
    if (!db || !memoizedPath) {
      setData([]);
      setLoading(false);
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
       // This case should ideally not be hit due to the check above, but as a safeguard:
      setData([]);
      setLoading(false);
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
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, memoizedPath]);

  return { data, loading, error };
}

export function useCollectionQuery<T>(query: Query<DocumentData> | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // We can't easily stringify the entire query for memoization, 
  // so we rely on the parent component to memoize the query object itself with useMemo.
  useEffect(() => {
    if (query === null) {
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
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [query]);

  return { data, loading, error };
}
