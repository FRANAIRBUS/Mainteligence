'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { initializeFirebase } from '.';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { FirebaseProvider } from './provider';
import { UserProvider } from './auth/use-user';
import type { FirebaseStorage } from 'firebase/storage';
import { Icons } from '@/components/icons';
import { AlertTriangle } from 'lucide-react';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

// We memoize the firebase instances to avoid re-initializing them on every render.
// This is safe because these are client-side singletons.
let firebaseInstances: {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
} | null = null;

export function FirebaseClientProvider({
  children,
}: FirebaseClientProviderProps) {
  const [firebase, setFirebase] = useState<{
    app: FirebaseApp;
    auth: Auth;
    firestore: Firestore;
    storage: FirebaseStorage;
  } | null>(firebaseInstances);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (firebase || error) return;

    let isMounted = true;

    initializeFirebase()
      .then((instances) => {
        if (isMounted) {
          firebaseInstances = instances;
          setFirebase(instances);
        }
      })
      .catch((err: Error) => {
        console.error('[Firebase] init error', err);
        if (isMounted) {
          setError(err.message);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [error, firebase]);

  if (!firebase) {
    if (error) {
      return (
        <div className="flex h-screen w-screen items-center justify-center px-6 text-center">
          <div className="max-w-md space-y-4">
            <div className="flex justify-center">
              <AlertTriangle className="h-10 w-10 text-destructive" />
            </div>
            <h1 className="text-xl font-semibold">No se pudo conectar con Firebase</h1>
            <p className="text-sm text-muted-foreground">
              {error}
            </p>
          </div>
        </div>
      );
    }

    return (
       <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <FirebaseProvider
      app={firebase.app}
      auth={firebase.auth}
      firestore={firebase.firestore}
      storage={firebase.storage}
    >
      <UserProvider>{children}</UserProvider>
    </FirebaseProvider>
  );
}
