// src/firebase/config.ts
import { FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app';

const firebaseConfig: FirebaseOptions = JSON.parse(
  process.env.NEXT_PUBLIC_FIREBASE_CONFIG || '{}'
);

// Initialize Firebase
let firebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApp();
}

export const app = firebaseApp;
