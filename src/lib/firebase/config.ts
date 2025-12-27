// src/lib/firebase/config.ts
import { FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";

// Fallback (NO es secreto). Sirve para que staging arranque si App Hosting no inyecta env vars.
const fallback = {
  apiKey: "AIzaSyBrEI-QvGZGEAoOM4Qrf3Y8d0Sjro71vko",
  authDomain: "studio-4350140400-a3f8f.firebaseapp.com",
  projectId: "studio-4350140400-a3f8f",
  appId: "1:975118694386:web:0cb5222ba248bf85a4dd6b",
  storageBucket: "studio-4350140400-a3f8f.firebasestorage.app",
  messagingSenderId: "975118694386",
} as const;

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? fallback.projectId;

const firebaseConfig: FirebaseOptions = {
  projectId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? fallback.appId,
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? fallback.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? fallback.authDomain,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? fallback.messagingSenderId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    fallback.storageBucket,
};

// Solo para diagnóstico (por si quieres mostrarlo en UI/logs)
export const missingFirebaseEnvVars = [
  !process.env.NEXT_PUBLIC_FIREBASE_API_KEY && "NEXT_PUBLIC_FIREBASE_API_KEY",
  !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN && "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  !process.env.NEXT_PUBLIC_FIREBASE_APP_ID && "NEXT_PUBLIC_FIREBASE_APP_ID",
].filter(Boolean) as string[];

// Initialize Firebase SOLO en cliente
let app: ReturnType<typeof getApp> | undefined = undefined;

if (typeof window !== "undefined") {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export { app };
