'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ClientLogo } from '@/components/client-logo';

import { useAuth, useFirestore, useUser, useFirebaseApp } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

type OrgCheckStatus = 'idle' | 'checking' | 'exists' | 'not-found' | 'error';

export default function LoginPage() {
  const auth = useAuth();
  const firestore = useFirestore();
  const app = useFirebaseApp();
  const router = useRouter();
  const { user } = useUser();

  const [isLoginView, setIsLoginView] = useState(true);

  // Login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register
  const [organizationId, setOrganizationId] = useState('');
  const [signupMode, setSignupMode] = useState<'join' | 'create'>('join');
  const [requestAdminRole, setRequestAdminRole] = useState(false);

  const [orgCheckStatus, setOrgCheckStatus] = useState<OrgCheckStatus>('idle');
  const [orgLookupName, setOrgLookupName] = useState<string | null>(null);
  const [orgLookupError, setOrgLookupError] = useState<string | null>(null);

  // New org details (only when create mode)
  const [orgName, setOrgName] = useState('');
  const [orgTaxId, setOrgTaxId] = useState('');
  const [orgCountry, setOrgCountry] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgBillingEmail, setOrgBillingEmail] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgTeamSize, setOrgTeamSize] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sanitizedOrgId = useMemo(() => String(organizationId ?? '').trim().toLowerCase(), [organizationId]);

  useEffect(() => {
    if (user) router.replace('/');
  }, [router, user]);

  // Reset when switching views
  useEffect(() => {
    setError(null);
    setEmail('');
    setPassword('');
    setOrganizationId('');
    setSignupMode('join');
    setRequestAdminRole(false);
    setOrgCheckStatus('idle');
    setOrgLookupName(null);
    setOrgLookupError(null);

    setOrgName('');
    setOrgTaxId('');
    setOrgCountry('');
    setOrgAddress('');
    setOrgBillingEmail('');
    setOrgPhone('');
    setOrgTeamSize('');
  }, [isLoginView]);

  // Check org existence (organizationsPublic) for UX only
  useEffect(() => {
    if (isLoginView || !firestore || signupMode !== 'join') {
      setOrgCheckStatus('idle');
      setOrgLookupName(null);
      setOrgLookupError(null);
      return;
    }

    if (!sanitizedOrgId) {
      setOrgCheckStatus('idle');
      setOrgLookupName(null);
      setOrgLookupError(null);
      return;
    }

    let cancelled = false;
    setOrgCheckStatus('checking');
    setOrgLookupError(null);

    (async () => {
      try {
        const orgRef = doc(firestore, 'organizationsPublic', sanitizedOrgId);
        const snapshot = await getDoc(orgRef);

        if (cancelled) return;

        if (snapshot.exists()) {
          const data = snapshot.data() as { name?: string };
          setOrgCheckStatus('exists');
          setOrgLookupName(data?.name ?? sanitizedOrgId);
        } else {
          setOrgCheckStatus('not-found');
          setOrgLookupName(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setOrgCheckStatus('error');
        setOrgLookupError(err?.message || 'No se pudo comprobar la organización.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, isLoginView, sanitizedOrgId, signupMode]);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setLoading(true);
    setError(null);
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

router.replace('/');

    } catch (err: any) {
      setError(err?.message || 'Error al iniciar sesión con Google');
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth || !app) return;

    setLoading(true);
    setError(null);

    try {
      const orgId = sanitizedOrgId;

      if (signupMode === 'create') {
        if (orgCheckStatus === 'exists') {
          throw new Error('Ese ID ya existe. Elige otro ID o cambia a "Unirme a una organización".');
        }
        if (!orgName.trim() || !orgCountry.trim()) {
          throw new Error('Para crear una nueva organización debes indicar nombre fiscal y país.');
        }
      } else {
        if (!orgId) throw new Error('Indica el ID de la organización.');
        if (orgCheckStatus === 'not-found') {
          throw new Error('La organización no existe. Cambia a "Crear una nueva organización" o revisa el ID.');
        }
      }

      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      const fn = httpsCallable(getFunctions(app), 'bootstrapSignup');

      const requestedRole = requestAdminRole ? 'admin' : 'operator';

      const payload: any = {
        organizationId: orgId,
        requestedRole,
      };

      if (signupMode === 'create') {
        payload.organizationDetails = {
          name: orgName.trim(),
          taxId: orgTaxId.trim() || null,
          country: orgCountry.trim(),
          address: orgAddress.trim() || null,
          billingEmail: (orgBillingEmail.trim() || email.trim()) ?? null,
          phone: orgPhone.trim() || null,
          teamSize: orgTeamSize ? Number(orgTeamSize) : null,
        };
      }

      const res = await fn(payload);
      const data = res?.data as any;

      if (data?.mode === 'pending') {
        router.replace('/onboarding');
      } else {
        router.replace('/');
      }
    } catch (err: any) {
      // If user is created but bootstrap fails, it's safer to send them to onboarding.
      setError(err?.message || 'Error al registrarse');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <ClientLogo />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isLoginView ? 'Iniciar sesión' : 'Crear cuenta'}</CardTitle>
            <CardDescription>
              {isLoginView
                ? 'Accede con tu correo y contraseña.'
                : 'Regístrate y selecciona tu organización o crea una nueva.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{error}</div>}

            <form onSubmit={isLoginView ? onLogin : onRegister} className="space-y-4">
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
                    <Label>¿Ya dispones de una organización o deseas crear una nueva?</Label>
                    <RadioGroup value={signupMode} onValueChange={(v) => setSignupMode(v as any)} className="gap-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem id="join" value="join" />
                        <Label htmlFor="join">Ya tengo un ID de organización (solicitar acceso)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem id="create" value="create" />
                        <Label htmlFor="create">Deseo crear una organización nueva</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {signupMode === 'join' && (
                    <div className="space-y-2">
                      <Label htmlFor="organizationId">ID de organización</Label>
                      <Input
                        id="organizationId"
                        placeholder="ej: mi-empresa"
                        value={organizationId}
                        onChange={(e) => setOrganizationId(e.target.value)}
                        required
                      />
                      <div className="text-xs text-muted-foreground">
                        {orgCheckStatus === 'checking' && 'Comprobando organización…'}
                        {orgCheckStatus === 'exists' && <>Organización encontrada: <b>{orgLookupName}</b></>}
                        {orgCheckStatus === 'not-found' && 'No existe una organización con ese ID.'}
                        {orgCheckStatus === 'error' && (orgLookupError || 'No se pudo comprobar la organización.')}
                      </div>
                    </div>
                  )}

                  <div className="flex items-start space-x-2">
                    <Checkbox
                      id="requestAdminRole"
                      checked={requestAdminRole}
                      onCheckedChange={(v) => setRequestAdminRole(Boolean(v))}
                    />
                    <Label htmlFor="requestAdminRole" className="leading-5">
                      Solicitar rol de admin (requiere aprobación)
                    </Label>
                  </div>

                  {signupMode === 'create' && (
                    <div className="rounded-md border p-4 space-y-3">
                      <div className="text-sm font-medium">Datos de la nueva organización</div>

                      <div className="space-y-2">
                        <Label htmlFor="orgName">Nombre fiscal</Label>
                        <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="orgCountry">País</Label>
                          <Input id="orgCountry" value={orgCountry} onChange={(e) => setOrgCountry(e.target.value)} required />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="orgTaxId">CIF/NIF</Label>
                          <Input id="orgTaxId" value={orgTaxId} onChange={(e) => setOrgTaxId(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="orgAddress">Dirección</Label>
                        <Input id="orgAddress" value={orgAddress} onChange={(e) => setOrgAddress(e.target.value)} />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="orgBillingEmail">Email facturación</Label>
                          <Input
                            id="orgBillingEmail"
                            type="email"
                            value={orgBillingEmail}
                            onChange={(e) => setOrgBillingEmail(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="orgPhone">Teléfono</Label>
                          <Input id="orgPhone" value={orgPhone} onChange={(e) => setOrgPhone(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="orgTeamSize">Tamaño equipo (aprox.)</Label>
                        <Input
                          id="orgTeamSize"
                          type="number"
                          min={1}
                          value={orgTeamSize}
                          onChange={(e) => setOrgTeamSize(e.target.value)}
                        />
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Al crear una organización nueva, tu usuario será <b>super_admin</b> automáticamente.
                      </div>
                    </div>
                  )}

                  {signupMode === 'join' && (
                    <div className="text-xs text-muted-foreground">
                      Al unirte a una organización existente, se crea una <b>solicitud pendiente</b> que debe aprobar un
                      super administrador.
                    </div>
                  )}
                </>
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
    </div>
  );
}
