// src/lib/firebase/index.ts
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { app, missingFirebaseEnvVars } from "./config";
import type { FirebaseApp } from "firebase/app";

export const initializeFirebase = async (): Promise<{
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
}> => {
  // Si por lo que sea no se inicializa en SSR, no petes: avisa y sigue.
  if (!app) {
    console.warn(
      `[Firebase] app not initialized yet. Missing env vars: ${
        missingFirebaseEnvVars.length ? missingFirebaseEnvVars.join(", ") : "none"
      }`
    );
    throw new Error(
      "Firebase no está disponible todavía (SSR/prerender). Reintenta en cliente."
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
} from "./provider";
export { FirebaseClientProvider } from "./client-provider";
export { useUser } from "./auth/use-user";
export { useCollection, useCollectionQuery } from "./firestore/use-collection";
export { useDoc, useDocRef } from "./firestore/use-doc";
