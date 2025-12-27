// src/firebase/index.ts
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { app, missingFirebaseEnvVars } from './config';
import type { FirebaseApp } from 'firebase/app';

export const initializeFirebase = async (): Promise<{
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
}> => {
  if (!app) {
    const missingVarsMessage = missingFirebaseEnvVars.length
      ? `Faltan variables de entorno: ${missingFirebaseEnvVars.join(', ')}`
      :
          'Revisa que el dominio esté autorizado en Firebase Auth y ' +
          'que las variables estén definidas en el backend de App Hosting (staging o prod).';

    throw new Error(
      `Firebase no pudo inicializarse. ${missingVarsMessage} ` +
        'Asegúrate de definir todas las NEXT_PUBLIC_FIREBASE_* en el entorno correcto y redeployar.'
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
