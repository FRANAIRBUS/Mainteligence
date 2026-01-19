// src/lib/firebase/index.ts

export { initializeFirebase } from './initialize';

export {
  FirebaseProvider,
  useFirebase,
  useFirebaseApp,
  useFirestore,
  useAuth,
  useStorage,
} from "./provider";
export { FirebaseClientProvider } from "./client-provider";
export { useUser, UserProvider } from "./auth/use-user";
export { useCollection, useCollectionQuery } from "./firestore/use-collection";
export { useDoc, useDocRef } from "./firestore/use-doc";
