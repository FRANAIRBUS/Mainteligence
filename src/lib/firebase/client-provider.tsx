'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { initializeFirebase } from '.';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { FirebaseProvider } from './provider';
import type { FirebaseStorage } from 'firebase/storage';
import { Icons } from '@/components/icons';

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
  } | null>(firebaseInstances); // Initialize with memoized instances if they exist

  useEffect(() => {
    // If firebase is already initialized (either from memoization or a previous run), don't do anything.
    if (firebase) return;

    let isMounted = true;
    
    getFirebaseInstances().then(instances => {
      if (isMounted) {
        setFirebase(instances);
      }
    }).catch(console.error); // It's good practice to catch potential errors during initialization

    return () => {
      isMounted = false;
    };
  }, [firebase]); // Only re-run if firebase state changes (which it shouldn't after the first load)

  if (!firebase) {
    // While firebase is initializing, show a full-screen loader.
    // This prevents any child components from attempting to access Firebase services
    // before they are ready, thus preventing the race condition.
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
      {children}
    </FirebaseProvider>
  );
}
