// src/lib/firebase/config.ts
import { FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";

const requiredEnvVars = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
} as const;

export const missingFirebaseEnvVars = (
  Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key)
);

const firebaseConfig: FirebaseOptions | null = missingFirebaseEnvVars.length
  ? null
  : {
      projectId: requiredEnvVars.projectId!,
      appId: requiredEnvVars.appId!,
      apiKey: requiredEnvVars.apiKey!,
      authDomain: requiredEnvVars.authDomain!,
      messagingSenderId: requiredEnvVars.messagingSenderId!,
      storageBucket: requiredEnvVars.storageBucket!,
    };

let app: ReturnType<typeof getApp> | undefined = undefined;

export const getClientFirebaseApp = () => {
  if (typeof window === "undefined") {
    throw new Error("[Firebase] La SDK cliente no puede inicializarse en el servidor.");
  }

  if (!firebaseConfig) {
    throw new Error(
      `[Firebase] Faltan variables de entorno: ${missingFirebaseEnvVars.join(", ")}`
    );
  }

  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }

  return app;
};
