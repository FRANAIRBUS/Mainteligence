'use client';
import { useState, useEffect } from 'react';
import { doc, onSnapshot, type DocumentReference, type DocumentData } from 'firebase/firestore';
import { useFirestore } from '../provider';
import { useUser } from '..';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';

const getOrgIdFromPath = (path: string) => {
  const match = path.match(/^organizations\/([^/]+)\//);
  return match?.[1] ?? null;
};

const isOrgMismatch = (path: string, organizationId: string, docData: DocumentData) => {
  const pathOrgId = getOrgIdFromPath(path);
  const docOrgId = typeof docData?.organizationId === 'string' ? docData.organizationId : null;

  if (pathOrgId) {
    if (pathOrgId !== organizationId) return true;
    if (docOrgId && docOrgId !== organizationId) return true;
    return false;
  }

  return docOrgId !== organizationId;
};

export function useDoc<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const db = useFirestore();
  const { user, loading: userLoading, organizationId, isRoot } = useUser();

  useEffect(() => {
    try {
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

      if (!user || path.includes('undefined')) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      if (isRoot) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      if (!organizationId) {
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

              if (isOrgMismatch(docRef.path, organizationId, docData)) {
                const organizationError = new Error(
                  docData.organizationId
                    ? 'Critical: Organization mismatch in transaction'
                    : 'Critical: Missing organizationId in transaction'
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
        (err: any) => {
          if (err?.code === 'permission-denied') {
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
  }, [db, organizationId, path, user, userLoading, isRoot]);

  return { data, loading, error };
}

export function useDocRef<T>(docRef: DocumentReference | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const { user, loading: userLoading, organizationId, isRoot } = useUser();

  useEffect(() => {
    try {
      if (!docRef || userLoading || !user || organizationId === undefined) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      if (isRoot) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      if (!organizationId) {
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

              if (isOrgMismatch(docRef.path, organizationId, docData)) {
                const organizationError = new Error(
                  docData.organizationId
                    ? 'Critical: Organization mismatch in transaction'
                    : 'Critical: Missing organizationId in transaction'
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
          setError(err as Error);
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
  }, [docRef, organizationId, user, userLoading, isRoot]);

  return { data, loading, error };
}
