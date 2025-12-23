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
    if (firebase) return;

    let isMounted = true;
    
    initializeFirebase().then(instances => {
      if (isMounted) {
        firebaseInstances = instances;
        setFirebase(instances);
      }
    }).catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [firebase]);

  if (!firebase) {
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
