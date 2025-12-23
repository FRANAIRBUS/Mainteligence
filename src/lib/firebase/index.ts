// src/firebase/index.ts
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { app } from './config';
import type { FirebaseApp } from 'firebase/app';

export const initializeFirebase = async (): Promise<{
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
}> => {
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  return { app, auth, firestore };
};

export {
  FirebaseProvider,
  useFirebase,
  useFirebaseApp,
  useFirestore,
  useAuth,
} from './provider';
export { FirebaseClientProvider } from './client-provider';
export { useUser } from './auth/use-user';
export { useCollection, useCollectionQuery } from './firestore/use-collection';
export { useDoc, useDocRef } from './firestore/use-doc';
