'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth, useFirestore } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, useEffect } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ClientLogo } from '@/components/client-logo';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoginView, setIsLoginView] = useState(true);
  const auth = useAuth();
  const firestore = useFirestore();
  const router = useRouter();

  // Reset form when switching views
  useEffect(() => {
    setError(null);
    setEmail('');
    setPassword('');
  }, [isLoginView]);

  const handleAuthAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setError(null);

    if (isLoginView) {
      // Login logic
      try {
        await signInWithEmailAndPassword(auth, email, password);
        router.push('/');
      } catch (err: any) {
        setError(err.message);
      }
    } else {
      // Register logic
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // After creating the user in Auth, create their profile in Firestore
        if (firestore && user) {
            const userDocRef = doc(firestore, 'users', user.uid);
            await setDoc(userDocRef, {
                displayName: user.email, // Default display name
                email: user.email,
                role: 'operario', // Default role for new sign-ups
                active: true,
                isMaintenanceLead: false,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true }); // Use merge to be safe
        }
        router.push('/');
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    if (!auth || !firestore) return;
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // After Google Sign-in, create or update their profile in Firestore
      const userDocRef = doc(firestore, 'users', user.uid);
      await setDoc(userDocRef, {
        displayName: user.displayName,
        email: user.email,
        // If the document doesn't exist, default to 'operario'. 
        // If it exists, this merge will not overwrite the existing role.
        role: 'operario',
        active: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      
      router.push('/');

    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
             <ClientLogo />
          </div>
          <CardTitle className="text-2xl">Maintelligence</CardTitle>
          <CardDescription>
            {isLoginView
              ? 'Inicia sesión para entrar en app'
              : 'Crea una cuenta para empezar'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuthAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                placeholder="m@ejemplo.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full">
              {isLoginView ? 'Iniciar Sesión' : 'Registrarse'}
            </Button>
          </form>
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                O
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
          >
            Entrar en app con Google
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center text-sm">
           <Button variant="link" onClick={() => setIsLoginView(!isLoginView)}>
                {isLoginView ? '¿No tienes una cuenta? Regístrate' : '¿Ya tienes una cuenta? Inicia Sesión'}
            </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
