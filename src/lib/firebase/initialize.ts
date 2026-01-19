// src/lib/firebase/initialize.ts
// NOTE: This module exists to avoid circular imports between `index.ts` (barrel)
// and `client-provider.tsx`.

import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import type { FirebaseApp } from "firebase/app";

import { getClientFirebaseApp } from "./config";

export const initializeFirebase = async (): Promise<{
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
}> => {
  // Client-only singleton initialization.
  const app = getClientFirebaseApp();

  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const storage = getStorage(app);

  return { app, auth, firestore, storage };
};
