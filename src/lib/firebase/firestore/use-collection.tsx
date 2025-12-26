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

  const memoizedPath = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef?.path;

  useEffect(() => {
    if (!memoizedPath) {
      setLoading(false);
      setData([]);
      setError(null);
      return;
    }

    if (!db || userLoading) {
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
        setData([]); 
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
    if (query === null) {
      setLoading(false);
      setData([]);
      setError(null);
      return;
    }

    if (userLoading) {
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
        setData([]); 
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [query, user, userLoading]); 

  return { data, loading, error };
}
