'use client';
import { useState, useEffect } from 'react';
import { doc, onSnapshot, DocumentReference } from 'firebase/firestore';
import { useFirestore } from '../provider';
import { useUser } from '..';

export function useDoc<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const db = useFirestore();
  const { user, loading: userLoading } = useUser();

  useEffect(() => {
    // If path is null, user not ready, or db not ready, we wait.
    if (!db || !path || userLoading) {
        setLoading(false);
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

    setLoading(true);
    const docRef = doc(db, path);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setData({ id: docSnap.id, ...docSnap.data() } as T);
        } else {
          // Document does not exist
          setData(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        // Handle errors, including permission errors
        console.error(`Error fetching document ${path}:`, err);
        setError(err);
        setData(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [db, path, user, userLoading]);
  
  return { data, loading, error };
}


export function useDocRef<T>(docRef: DocumentReference | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { user, loading: userLoading } = useUser();

  useEffect(() => {
    // If docRef is null, or user is not ready, we are not ready to fetch.
    if (!docRef || userLoading || !user) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setData({ id: docSnap.id, ...docSnap.data() } as T);
      } else {
        setData(null);
      }
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error(`Error fetching document ref ${docRef.path}:`, err);
      setError(err);
      setData(null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [docRef, user, userLoading]);

  return { data, loading, error };
}
