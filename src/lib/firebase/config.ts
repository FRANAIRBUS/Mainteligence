// src/firebase/config.ts
import { FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const firebaseConfig: FirebaseOptions = {
  projectId: projectId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: projectId ? `${projectId}.appspot.com` : undefined,
};

// Validate the config
if (
  !firebaseConfig.apiKey ||
  !firebaseConfig.authDomain ||
  !firebaseConfig.projectId ||
  !firebaseConfig.storageBucket
) {
  throw new Error('Missing Firebase config. Please check your .env file and ensure all required variables are set.');
}


// Initialize Firebase
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

export { app };
