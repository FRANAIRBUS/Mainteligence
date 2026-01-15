'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ClientLogo } from '@/components/client-logo';

import { useAuth, useUser, useFirebaseApp } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  applyActionCode,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

export default function LoginPage() {
  const auth = useAuth();
  const app = useFirebaseApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, organizationId, activeMembership, isRoot, loading: userLoading } = useUser();

  const [isLoginView, setIsLoginView] = useState(true);

  // Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captchaAccepted, setCaptchaAccepted] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (userLoading) return;
    if (!user) return;

    if (isRoot) {
      router.replace('/root');
      return;
    }

    if (activeMembership?.status === 'active' || organizationId) {
      router.replace('/');
      return;
    }

    router.replace('/onboarding');
  }, [activeMembership, isRoot, organizationId, router, user, userLoading]);

  useEffect(() => {
    if (!auth || !searchParams) return;
    const mode = searchParams.get('mode');
    const oobCode = searchParams.get('oobCode');
    if (mode !== 'verifyEmail' || !oobCode) return;

    setLoading(true);
    setError(null);
    setNotice(null);
    setIsLoginView(true);

    (async () => {
      try {
        await applyActionCode(auth, oobCode);
        setNotice('Email verificado. Inicia sesión para continuar.');
      } catch (err: any) {
        setError(err?.message || 'No se pudo verificar el email. Solicita un nuevo enlace.');
      } finally {
        setLoading(false);
      }
    })();
  }, [auth, searchParams]);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setCaptchaAccepted(false);
  }, [isLoginView]);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);

      // If this user was invited before registering, attach pending invites/memberships.
      try {
        if (app) {
          const fn = httpsCallable(getFunctions(app, 'us-central1'), 'bootstrapFromInvites');
          const res = await fn({});
          const data = res?.data as any;
          if (Number(data?.claimed ?? 0) > 0) {
            router.replace('/onboarding');
            return;
          }
        }
      } catch {
        // non-blocking
      }

      try {
        if (app && auth.currentUser) {
          await auth.currentUser.reload();
          if (auth.currentUser.emailVerified) {
            const fn = httpsCallable(getFunctions(app, 'us-central1'), 'finalizeOrganizationSignup');
            const res = await fn({});
            const data = res?.data as any;
            if (data?.mode === 'created') {
              router.replace('/');
              return;
            }
          }
        }
      } catch {
        // non-blocking
      }

      router.replace('/');
    } catch (err: any) {
      setError(err?.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    if (!auth) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);

      // If this Google account was invited before, claim pending invites and route accordingly.
      try {
        if (app) {
          const fn = httpsCallable(getFunctions(app, 'us-central1'), 'bootstrapFromInvites');
          const res = await fn({});
          const data = res?.data as any;
          if (Number(data?.claimed ?? 0) > 0) {
            router.replace('/onboarding');
            return;
          }
        }
      } catch {
        // non-blocking
      }

      try {
        if (app && auth.currentUser) {
          await auth.currentUser.reload();
          if (auth.currentUser.emailVerified) {
            const fn = httpsCallable(getFunctions(app, 'us-central1'), 'finalizeOrganizationSignup');
            const res = await fn({});
            const data = res?.data as any;
            if (data?.mode === 'created') {
              router.replace('/');
              return;
            }
          }
        }
      } catch {
        // non-blocking
      }

      router.replace('/');
    } catch (err: any) {
      setError(err?.message || 'Error al iniciar sesión con Google');
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (password.trim().length < 6) {
        throw new Error('La contraseña debe tener al menos 6 caracteres.');
      }
      if (password.trim() !== confirmPassword.trim()) {
        throw new Error('Las contraseñas no coinciden.');
      }
      if (!captchaAccepted) {
        throw new Error('Confirma el captcha para crear la cuenta.');
      }

      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user);
      }

      setNotice('Cuenta creada. Revisa tu correo para verificar tu email y continúa el alta.');
      router.replace('/onboarding');
    } catch (err: any) {
      setError(err?.message || 'Error al registrarse');
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    if (!auth) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (!email.trim()) {
        throw new Error('Introduce tu correo para enviar el enlace de recuperación.');
      }
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('Enlace de recuperación enviado. Revisa tu bandeja de entrada.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar el enlace de recuperación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-muted/30">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 py-10 text-center">
        <div className="space-y-6">
          <div className="flex items-center justify-center gap-3">
            <ClientLogo />
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              MAINTELLIGENCE
            </span>
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              Gestión inteligente de Tareas,
              <br />
              Incidencias y Mantenimientos.
            </h1>
            <p className="text-muted-foreground">
              Centraliza la operación de tu organización, controla incidencias y acelera la toma de decisiones.
            </p>
          </div>
        </div>

        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>{isLoginView ? 'Iniciar sesión' : 'Crear cuenta'}</CardTitle>
              <CardDescription>
                {isLoginView
                  ? 'Accede con tu correo y contraseña.'
                  : 'Crea tu cuenta y después elige tu organización o prueba la demo.'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {error && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  {error}
                </div>
              )}
              {notice && (
                <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-900">
                  {notice}
                </div>
              )}

              <form onSubmit={isLoginView ? onLogin : onRegister} className="space-y-4 text-left">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="nombre@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {!isLoginView && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>

                    <div className="flex items-start space-x-2">
                      <Checkbox
                        id="captcha"
                        checked={captchaAccepted}
                        onCheckedChange={(v) => setCaptchaAccepted(Boolean(v))}
                      />
                      <Label htmlFor="captcha" className="leading-5">
                        No soy un robot (captcha)
                      </Label>
                    </div>
                  </>
                )}

                {isLoginView && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto w-full justify-start px-0 text-sm"
                    onClick={onResetPassword}
                    disabled={loading}
                  >
                    ¿Olvidaste tu contraseña?
                  </Button>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Procesando…' : isLoginView ? 'Entrar' : 'Crear cuenta'}
                </Button>

                <Button type="button" variant="outline" className="w-full" onClick={onGoogle} disabled={loading}>
                  Continuar con Google
                </Button>
              </form>
            </CardContent>

            <CardFooter className="flex flex-col gap-2">
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() => setIsLoginView((v) => !v)}
                disabled={loading}
              >
                {isLoginView ? '¿No tienes cuenta? Crear cuenta' : 'Ya tengo cuenta. Iniciar sesión'}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="w-full max-w-xl space-y-2 rounded-xl border bg-background p-4 text-left text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Lo nuevo en la plataforma</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Acceso seguro con correo o Google.</li>
            <li>Registro guiado con captcha y verificación.</li>
            <li>Elección de organización tras iniciar sesión.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
