
'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { initializeFirebase } from '.';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { FirebaseProvider } from './provider';
import type { FirebaseStorage } from 'firebase/storage';

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

async function getFirebaseInstances() {
  if (!firebaseInstances) {
    firebaseInstances = await initializeFirebase();
  }
  return firebaseInstances;
}


export function FirebaseClientProvider({
  children,
}: FirebaseClientProviderProps) {
  const [firebase, setFirebase] = useState<{
    app: FirebaseApp;
    auth: Auth;
    firestore: Firestore;
    storage: FirebaseStorage;
  } | null>(firebaseInstances);

  useEffect(() => {
    // If firebase is already initialized, don't do anything.
    if (firebase) return;

    let isMounted = true;
    
    getFirebaseInstances().then(instances => {
      if (isMounted) {
        setFirebase(instances);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [firebase]);

  if (!firebase) {
    // While firebase is initializing, you can show a loader or nothing.
    // Returning children directly is one way to avoid content layout shifts
    // but it might cause hydration errors if the server renders something different.
    // For this case, returning children is safe because the server also renders children.
    return <>{children}</>;
  }

  return (
    <FirebaseProvider
      app={firebase.app}
      auth={firebase.auth}
      firestore={firebase.firestore}
      storage={firebase.storage}
    >
      {children}
    </FirebaseProvider>
  );
}
