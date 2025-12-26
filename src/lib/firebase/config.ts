// src/firebase/config.ts
import { FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const storageBucket =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
  (projectId ? `${projectId}.appspot.com` : undefined);

const firebaseConfig: FirebaseOptions = {
  projectId: projectId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

if (storageBucket) {
  firebaseConfig.storageBucket = storageBucket;
}

// Validate the config (pero NO rompas el build en SSR/prerender)
const isConfigValid =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.authDomain &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.appId;

// Initialize Firebase SOLO en cliente.
// En server/build-time devolvemos undefined para evitar crashes en prerender.
let app: ReturnType<typeof initializeApp> | undefined;

if (typeof window !== "undefined") {
  if (!isConfigValid) {
    // No lanzamos error (evita que CI/SSR caiga). Aviso solo en dev.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[firebase] Missing NEXT_PUBLIC_FIREBASE_* env vars. Firebase not initialized."
      );
    }
  } else {
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  }
}

export { app };
