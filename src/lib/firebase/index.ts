// src/firebase/index.ts
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { app } from './config';
import type { FirebaseApp } from 'firebase/app';

export const initializeFirebase = async (): Promise<{
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
}> => {
  if (!app) {
    throw new Error(
      'Firebase no pudo inicializarse. Revisa que las variables NEXT_PUBLIC_FIREBASE_* estén configuradas y que el dominio esté autorizado en Firebase Auth.'
    );
  }

  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const storage = getStorage(app);

  return { app, auth, firestore, storage };
};

export {
  FirebaseProvider,
  useFirebase,
  useFirebaseApp,
  useFirestore,
  useAuth,
  useStorage,
} from './provider';
export { FirebaseClientProvider } from './client-provider';
export { useUser } from './auth/use-user';
export { useCollection, useCollectionQuery } from './firestore/use-collection';
export { useDoc, useDocRef } from './firestore/use-doc';
