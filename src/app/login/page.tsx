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
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth, useFirestore, useUser } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, useEffect } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { ClientLogo } from '@/components/client-logo';
import { DEFAULT_ORGANIZATION_ID } from '@/lib/organization';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationId, setOrganizationId] = useState(DEFAULT_ORGANIZATION_ID);
  const [requestAdminRole, setRequestAdminRole] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isLoginView, setIsLoginView] = useState(true);
  const [registerStep, setRegisterStep] = useState(1);
  const [orgCheckStatus, setOrgCheckStatus] = useState<'idle' | 'checking' | 'exists' | 'not-found' | 'error'>('idle');
  const [orgLookupName, setOrgLookupName] = useState<string | null>(null);
  const [orgLookupError, setOrgLookupError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgTaxId, setOrgTaxId] = useState('');
  const [orgCountry, setOrgCountry] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgBillingEmail, setOrgBillingEmail] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgTeamSize, setOrgTeamSize] = useState('');
  const auth = useAuth();
  const firestore = useFirestore();
  const router = useRouter();
  const { user } = useUser();

  useEffect(() => {
    if (user) {
      router.replace('/');
    }
  }, [router, user]);

  // Reset form when switching views
  useEffect(() => {
    setError(null);
    setEmail('');
    setPassword('');
    setOrganizationId(DEFAULT_ORGANIZATION_ID);
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
    setRegisterStep(1);
  }, [isLoginView]);

  useEffect(() => {
    if (isLoginView || !firestore) {
      setOrgCheckStatus('idle');
      setOrgLookupName(null);
      setOrgLookupError(null);
      return;
    }

    const sanitizedOrgId = organizationId?.trim();

    if (!sanitizedOrgId) {
      setOrgCheckStatus('idle');
      setOrgLookupName(null);
      setOrgLookupError(null);
      return;
    }

    let isCancelled = false;
    setOrgCheckStatus('checking');
    setOrgLookupError(null);

    const checkOrg = async () => {
      try {
        const orgRef = doc(firestore, 'organizations', sanitizedOrgId);
        const snapshot = await getDoc(orgRef);

        if (isCancelled) return;
        if (snapshot.exists()) {
          const data = snapshot.data() as { name?: string };
          setOrgCheckStatus('exists');
          setOrgLookupName(data?.name ?? sanitizedOrgId);
        } else {
          setOrgCheckStatus('not-found');
          setOrgLookupName(null);
        }
      } catch (err: any) {
        if (isCancelled) return;
        if (err?.code === 'permission-denied') {
          setOrgCheckStatus('not-found');
          setOrgLookupName(null);
          setOrgLookupError(
            'No se pudo comprobar la organización sin iniciar sesión. Continuaremos con el alta y la validaremos al crear tu cuenta.',
          );
          return;
        }
        setOrgCheckStatus('error');
        setOrgLookupError(
          err?.message || 'No se pudo comprobar la organización. Inténtalo nuevamente.',
        );
      }
    };

    checkOrg();

    return () => {
      isCancelled = true;
    };
  }, [firestore, isLoginView, organizationId]);

  const ensureOrganizationExists = async (sanitizedOrgId: string, userEmail: string) => {
    if (!firestore) {
      throw new Error('Firestore no está disponible.');
    }

    const orgRef = doc(firestore, 'organizations', sanitizedOrgId);
    const orgSnap = await getDoc(orgRef);

    if (orgSnap.exists()) {
      return { created: false, name: (orgSnap.data() as { name?: string }).name ?? sanitizedOrgId };
    }

    if (!orgName.trim() || !orgCountry.trim()) {
      throw new Error('Para crear una nueva organización debes indicar nombre fiscal y país.');
    }

    const normalizedTeamSize = orgTeamSize ? Number(orgTeamSize) : undefined;
    const defaultLimits = {
      maxUsers: Number.isFinite(normalizedTeamSize) ? normalizedTeamSize : 50,
      monthlyTickets: 500,
      monthlyTasks: 500,
      storageMb: 1024,
    };

    await setDoc(orgRef, {
      organizationId: sanitizedOrgId,
      name: orgName.trim(),
      taxId: orgTaxId.trim() || null,
      country: orgCountry.trim(),
      address: orgAddress.trim() || null,
      billingEmail: orgBillingEmail.trim() || userEmail,
      contactPhone: orgPhone.trim() || null,
      teamSize: Number.isFinite(normalizedTeamSize) ? normalizedTeamSize : null,
      subscriptionPlan: 'trial',
      isActive: true,
      settings: {
        allowGuestAccess: false,
        maxUsers: defaultLimits.maxUsers,
      },
      limits: defaultLimits,
      usage: {
        users: 1,
        ticketsThisMonth: 0,
        tasksThisMonth: 0,
        storageMb: 0,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { created: true, name: orgName.trim() };
  };

  const upsertMembership = async (
    userId: string,
    sanitizedOrgId: string,
    role: 'admin' | 'operario' | 'mantenimiento',
    organizationName?: string,
    status: 'active' | 'pending' = 'active',
  ) => {
    if (!firestore) {
      return;
    }

    const membershipRef = doc(firestore, 'memberships', `${userId}_${sanitizedOrgId}`);
    await setDoc(
      membershipRef,
      {
        userId,
        organizationId: sanitizedOrgId,
        organizationName: organizationName ?? sanitizedOrgId,
        role,
        status,
        primary: role === 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const buildUserProfilePayload = (
    sanitizedOrgId: string,
    userEmail: string,
    isNewOrganization: boolean,
  ) => {
    return {
      displayName: userEmail,
      email: userEmail,
      role: isNewOrganization ? 'admin' : 'operario',
      active: true,
      isMaintenanceLead: isNewOrganization,
      organizationId: sanitizedOrgId,
      adminRequestPending: !isNewOrganization && requestAdminRole,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  };

  const validateRegisterStep = () => {
    if (!organizationId?.trim() && !isLoginView) {
      setError('Debes ingresar un organizationId para tu empresa.');
      return false;
    }

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return false;
    }

    if (registerStep === 2 && orgCheckStatus === 'error') {
      setError('No se pudo comprobar la organización. Revisa el identificador.');
      return false;
    }

    if (registerStep === 3 && orgCheckStatus === 'not-found') {
      if (!orgName.trim() || !orgCountry.trim()) {
        setError('Indica al menos nombre fiscal y país para crear la organización.');
        return false;
      }
    }

    setError(null);
    return true;
  };

  const handleLogin = async () => {
    if (!auth) return;
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/');
    } catch (err: any) {
      setError(getFriendlyMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const completeRegistration = async () => {
    if (!auth) return;
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // After creating the user in Auth, create their profile in Firestore
      if (firestore && user) {
        const sanitizedOrgId = organizationId?.trim() || DEFAULT_ORGANIZATION_ID;
        const shouldCreateOrg = orgCheckStatus === 'not-found';
        const { created, name } = await ensureOrganizationExists(sanitizedOrgId, user.email || email);
        const isNewOrganization = shouldCreateOrg || created;
        const orgDisplayName = name || sanitizedOrgId;

        const userDocRef = doc(firestore, 'users', user.uid);
        await setDoc(
          userDocRef,
          buildUserProfilePayload(sanitizedOrgId, user.email || email, isNewOrganization),
          {
            merge: true,
          },
        );

        await upsertMembership(
          user.uid,
          sanitizedOrgId,
          isNewOrganization ? 'admin' : 'operario',
          orgDisplayName,
          requestAdminRole && !isNewOrganization ? 'pending' : 'active',
        );

        if (requestAdminRole && !isNewOrganization) {
          const adminRequests = collection(firestore, 'adminRequests');
          await addDoc(adminRequests, {
            userId: user.uid,
            email: user.email,
            organizationId: sanitizedOrgId,
            status: 'pending',
            createdAt: serverTimestamp(),
          });
        }
      }
      router.push('/');
    } catch (err: any) {
      setError(getFriendlyMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegistrationFlow = async () => {
    const isValid = validateRegisterStep();
    if (!isValid) {
      return;
    }

    if (registerStep < 4) {
      setRegisterStep((prev) => prev + 1);
      return;
    }

    await completeRegistration();
  };

  const handleAuthAction = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isLoginView) {
      await handleLogin();
      return;
    }

    await handleRegistrationFlow();
  };

  const handleGoogleSignIn = async () => {
    if (!auth || !firestore) return;
    setError(null);
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Resolve existing profile to avoid sobrescribir organizationId en re-logins.
      const userDocRef = doc(firestore, 'users', user.uid);
      const existingProfile = await getDoc(userDocRef);
      const sanitizedOrgId = organizationId?.trim() || DEFAULT_ORGANIZATION_ID;
      const resolvedOrgId = (existingProfile.data() as { organizationId?: string } | undefined)?.organizationId
        || sanitizedOrgId;

      const shouldCreateOrg = orgCheckStatus === 'not-found' || (!existingProfile.exists() && orgCheckStatus === 'idle');
      const { created, name } = await ensureOrganizationExists(resolvedOrgId, user.email || email);
      const isNewOrganization = shouldCreateOrg || created;
      const orgDisplayName = name || orgLookupName || resolvedOrgId;

      // After Google Sign-in, create or update their profile in Firestore
      await setDoc(
        userDocRef,
        buildUserProfilePayload(resolvedOrgId, user.email || email, isNewOrganization),
        { merge: true },
      );

      await upsertMembership(
        user.uid,
        resolvedOrgId,
        isNewOrganization ? 'admin' : 'operario',
        orgDisplayName,
        requestAdminRole && !isNewOrganization ? 'pending' : 'active',
      );

      if (requestAdminRole && !isNewOrganization) {
        const adminRequests = collection(firestore, 'adminRequests');
        await addDoc(adminRequests, {
          userId: user.uid,
          email: user.email,
          organizationId: resolvedOrgId,
          status: 'pending',
          createdAt: serverTimestamp(),
        });
      }

      router.push('/');
    } catch (err: any) {
      setError(getFriendlyMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const getFriendlyMessage = (err: { code?: string; message?: string }) => {
    const messages: Record<string, string> = {
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'No existe un usuario con este correo.',
      'auth/wrong-password': 'La contraseña es incorrecta.',
      'auth/email-already-in-use': 'Ya existe una cuenta con este correo.',
      'auth/popup-closed-by-user': 'Se cerró la ventana de inicio de sesión.',
    };

    if (err.code && messages[err.code]) {
      return messages[err.code];
    }
    return err.message || 'Ocurrió un error. Inténtalo nuevamente.';
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-3xl">
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
          {!isLoginView && (
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={`rounded-full px-3 py-1 ${registerStep === step ? 'bg-primary/10 text-primary' : 'bg-muted'}`}
                >
                  {step === 1 && 'Cuenta'}
                  {step === 2 && 'Organización'}
                  {step === 3 && 'Datos básicos'}
                  {step === 4 && 'Confirmación'}
                </span>
              ))}
            </div>
          )}
          <form onSubmit={handleAuthAction} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>
            {!isLoginView && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="organizationId">ID de organización</Label>
                  <Input
                    id="organizationId"
                    placeholder="tu-empresa"
                    required
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Paso 1 · Identifica la organización con la que quieres trabajar.
                  </p>
                </div>
                {registerStep >= 2 && (
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2 text-sm font-medium text-foreground">
                      <Checkbox
                        checked={requestAdminRole}
                        onCheckedChange={(checked) => setRequestAdminRole(Boolean(checked))}
                      />
                      <span>Solicitar permisos de administrador</span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Si la organización ya existe, generaremos una solicitud pendiente. Si es nueva, serás admin principal.
                    </p>
                  </div>
                )}
              </div>
            )}

            {!isLoginView && registerStep >= 2 && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-2 text-sm font-medium">Paso 2 · Resultado de la búsqueda</div>
                <div className="text-xs">
                  {orgCheckStatus === 'checking' && (
                    <p className="text-muted-foreground">Buscando organización...</p>
                  )}
                  {orgCheckStatus === 'exists' && (
                    <p className="text-green-600">
                      Organización encontrada: {orgLookupName || organizationId}. Puedes unirte o solicitar rol de admin.
                    </p>
                  )}
                  {orgCheckStatus === 'not-found' && (
                    <p className="text-amber-600">
                      Crearemos una nueva organización con este ID y te convertiremos en administrador principal.
                    </p>
                  )}
                  {orgLookupError && orgCheckStatus !== 'error' && (
                    <p className="text-muted-foreground">{orgLookupError}</p>
                  )}
                  {orgCheckStatus === 'error' && (
                    <p className="text-destructive">{orgLookupError}</p>
                  )}
                </div>
              </div>
            )}

            {!isLoginView && registerStep >= 3 && orgCheckStatus === 'not-found' && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 space-y-1">
                  <p className="text-sm font-medium">Paso 3 · Datos de la nueva organización</p>
                  <p className="text-xs text-muted-foreground">
                    Requerimos nombre fiscal y país; el resto es opcional para agilizar la creación.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="orgName">Nombre fiscal *</Label>
                    <Input
                      id="orgName"
                      placeholder="Mi Empresa S.L."
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="orgCountry">País *</Label>
                    <Input
                      id="orgCountry"
                      placeholder="España"
                      value={orgCountry}
                      onChange={(e) => setOrgCountry(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="orgTaxId">NIF/CIF</Label>
                    <Input
                      id="orgTaxId"
                      placeholder="B12345678"
                      value={orgTaxId}
                      onChange={(e) => setOrgTaxId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="orgBillingEmail">Email de facturación</Label>
                    <Input
                      id="orgBillingEmail"
                      placeholder="facturacion@miempresa.com"
                      value={orgBillingEmail}
                      onChange={(e) => setOrgBillingEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="orgAddress">Dirección</Label>
                    <Input
                      id="orgAddress"
                      placeholder="Calle Mayor 1, Madrid"
                      value={orgAddress}
                      onChange={(e) => setOrgAddress(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="orgPhone">Teléfono de contacto</Label>
                    <Input
                      id="orgPhone"
                      placeholder="+34 600 000 000"
                      value={orgPhone}
                      onChange={(e) => setOrgPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="orgTeamSize">Tamaño de plantilla (aprox.)</Label>
                    <Input
                      id="orgTeamSize"
                      type="number"
                      min={1}
                      placeholder="50"
                      value={orgTeamSize}
                      onChange={(e) => setOrgTeamSize(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {!isLoginView && registerStep >= 4 && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 space-y-1">
                  <p className="text-sm font-medium">Paso 4 · Confirmación final</p>
                  <p className="text-xs text-muted-foreground">
                    Crearemos tu perfil y una membresía activa. Podrás alternar de organización desde el menú de usuario.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">Organización</p>
                    <p className="text-muted-foreground">{orgLookupName || organizationId}</p>
                    <p className="text-xs text-muted-foreground">
                      Estado: {orgCheckStatus === 'exists' ? 'Ya existe' : 'Se creará como nueva'}
                    </p>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">Rol y permisos</p>
                    <p className="text-muted-foreground">
                      {orgCheckStatus === 'not-found'
                        ? 'Serás administrador principal'
                        : requestAdminRole
                          ? 'Solicitud de admin pendiente + acceso como operario'
                          : 'Acceso como operario'}
                    </p>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">Límites iniciales</p>
                    <p className="text-muted-foreground">
                      Plan trial: hasta 50 usuarios, 500 tareas/incidencias al mes y 1GB de adjuntos.
                    </p>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">Multi‑organización</p>
                    <p className="text-muted-foreground">
                      Puedes usar el mismo correo en distintas organizaciones; cada alta creará una membresía seleccionable.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {!isLoginView && registerStep > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRegisterStep((prev) => Math.max(1, prev - 1))}
                  disabled={loading}
                >
                  Atrás
                </Button>
              )}
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={loading || (!isLoginView && orgCheckStatus === 'checking' && registerStep >= 2)}
              >
                {loading
                  ? 'Procesando...'
                  : isLoginView
                    ? 'Iniciar Sesión'
                    : registerStep < 4
                      ? `Continuar (${registerStep}/4)`
                      : 'Crear cuenta y perfil'}
              </Button>
            </div>
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
            disabled={loading}
          >
            Entrar en app con Google
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center text-sm">
          <Button variant="link" onClick={() => setIsLoginView(!isLoginView)}>
            {isLoginView
              ? '¿No tienes una cuenta? Regístrate'
              : '¿Ya tienes una cuenta? Inicia Sesión'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
