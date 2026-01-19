'use client';
import { useState, useEffect } from 'react';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useFirestore } from '../provider';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';
import { useUser } from '../auth/use-user';

const getOrgScopedCollectionName = (path: string, organizationId: string | null) => {
  if (!organizationId) return null;
  const prefix = `organizations/${organizationId}/`;
  if (!path.startsWith(prefix)) return null;
  const remainder = path.slice(prefix.length);
  return remainder.split('/')[0] ?? null;
};

const shouldApplyOrgFilter = (path: string, organizationId: string | null) => {
  const collectionName = getOrgScopedCollectionName(path, organizationId);
  return !collectionName;
};

export function useCollection<T>(path: string | null, ...queries: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const db = useFirestore();
  const { user, loading: userLoading, organizationId, isRoot } = useUser();

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

      // Root users never read tenant data via client SDK.
      if (isRoot) {
        setLoading(false);
        setData([]);
        setError(null);
        return;
      }

      if (!organizationId) {
        const organizationError = new Error('Critical: Missing organizationId in transaction');
        setError(organizationError);
        setData([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const orgScope = shouldApplyOrgFilter(path, organizationId)
        ? [where('organizationId', '==', organizationId)]
        : [];

      const collectionQuery = query(collection(db, path), ...orgScope, ...queries);

      const unsubscribe = onSnapshot(
        collectionQuery,
        (snapshot) => {
          try {
            const newData = snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
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
        (err: any) => {
          if (err?.code === 'permission-denied') {
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
  }, [db, path, user, userLoading, organizationId, isRoot, ...queries]);

  return { data, loading, error };
}

export function useCollectionQuery<T>(path: string | null, ...queries: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const db = useFirestore();
  const { user, loading: userLoading, organizationId, isRoot } = useUser();

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

      if (isRoot) {
        setLoading(false);
        setData([]);
        setError(null);
        return;
      }

      if (!organizationId) {
        const organizationError = new Error('Critical: Missing organizationId in transaction');
        setError(organizationError);
        setData([]);
        setLoading(false);
        return;
      }

      const orgScope = shouldApplyOrgFilter(path, organizationId)
        ? [where('organizationId', '==', organizationId)]
        : [];
      const preparedQuery = query(collection(db, path), ...orgScope, ...queries);

      setLoading(true);
      const unsubscribe = onSnapshot(
        preparedQuery,
        (snapshot) => {
          try {
            const newData = snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
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
        (err: any) => {
          if (err?.code === 'permission-denied') {
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
  }, [db, organizationId, path, user, userLoading, isRoot, ...queries]);

  return { data, loading, error };
}

export function useCollectionPage<T>(
  path: string | null,
  options: { pageSize?: number; cursor?: QueryDocumentSnapshot<DocumentData> | null; listen?: boolean } = {},
  ...queries: QueryConstraint[]
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const db = useFirestore();
  const { user, loading: userLoading, organizationId, isRoot } = useUser();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const run = async () => {
      try {
        if (!path) {
          setLoading(false);
          setData([]);
          setError(null);
          setHasMore(false);
          setNextCursor(null);
          return;
        }

        if (!db || userLoading || organizationId === undefined) {
          setLoading(true);
          setData([]);
          setError(null);
          setHasMore(false);
          setNextCursor(null);
          return;
        }

        if (!user) {
          setLoading(false);
          setData([]);
          setError(null);
          setHasMore(false);
          setNextCursor(null);
          return;
        }

        if (isRoot) {
          setLoading(false);
          setData([]);
          setError(null);
          setHasMore(false);
          setNextCursor(null);
          return;
        }

        if (!organizationId) {
          const organizationError = new Error('Critical: Missing organizationId in transaction');
          setError(organizationError);
          setData([]);
          setLoading(false);
          setHasMore(false);
          setNextCursor(null);
          return;
        }

        setLoading(true);
        const pageSize = options.pageSize ?? 50;
        const cursorConstraint = options.cursor ? [startAfter(options.cursor)] : [];
        const orgScope = shouldApplyOrgFilter(path, organizationId)
          ? [where('organizationId', '==', organizationId)]
          : [];
        const collectionQuery = query(
          collection(db, path),
          ...orgScope,
          ...queries,
          ...cursorConstraint,
          limit(pageSize)
        );

        if (options.listen === false) {
          const snapshot = await getDocs(collectionQuery);
          const newData = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })) as T[];
          setData(newData);
          setHasMore(snapshot.size === pageSize);
          setNextCursor(snapshot.docs[snapshot.docs.length - 1] ?? null);
          setLoading(false);
          setError(null);
          return;
        }

        unsubscribe = onSnapshot(
          collectionQuery,
          (snapshot) => {
            try {
              const newData = snapshot.docs.map((docSnap) => ({
                id: docSnap.id,
                ...docSnap.data(),
              })) as T[];
              setData(newData);
              setHasMore(snapshot.size === pageSize);
              setNextCursor(snapshot.docs[snapshot.docs.length - 1] ?? null);
              setLoading(false);
              setError(null);
            } catch (snapshotError) {
              setError(snapshotError as Error);
              setData([]);
              setHasMore(false);
              setNextCursor(null);
              setLoading(false);
            }
          },
          (err: any) => {
            if (err?.code === 'permission-denied') {
              const permissionError = new FirestorePermissionError({
                path,
                operation: 'list',
              });
              errorEmitter.emit('permission-error', permissionError);
            }
            console.error(`Error fetching collection ${path}:`, err);
            setError(err);
            setData([]);
            setHasMore(false);
            setNextCursor(null);
            setLoading(false);
          }
        );
      } catch (err) {
        setError(err as Error);
        setData([]);
        setHasMore(false);
        setNextCursor(null);
        setLoading(false);
      }
    };

    void run();

    return () => {
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, path, user, userLoading, organizationId, isRoot, options.pageSize, options.cursor, options.listen, ...queries]);

  return { data, loading, error, hasMore, nextCursor };
}
