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

export function useCollection<T>(pathOrRef: string | CollectionReference | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();

  useEffect(() => {
    if (!db || !pathOrRef) {
      setLoading(false);
      setData([]);
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
  }, [db, typeof pathOrRef === 'string' ? pathOrRef : pathOrRef?.path]);

  return { data, loading, error };
}

export function useCollectionQuery<T>(query: Query<DocumentData> | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
  // We stringify the query object to use it as a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query ? (query as any)._query.path.segments.join('/') : null, query ? JSON.stringify((query as any)._query.filters) : null]);

  return { data, loading, error };
}
