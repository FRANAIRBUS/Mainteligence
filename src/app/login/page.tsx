'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ClientLogo } from '@/components/client-logo';

import { useAuth, useUser, useFirebaseApp } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

type OrgCheckStatus = 'idle' | 'checking' | 'exists' | 'available' | 'error';

export default function LoginPage() {
  const auth = useAuth();
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
  const [orgNormalizedId, setOrgNormalizedId] = useState<string | null>(null);
  const [orgSuggestions, setOrgSuggestions] = useState<string[]>([]);
  const [orgSelectedSuggestion, setOrgSelectedSuggestion] = useState<string | null>(null);
  const [orgNameMatches, setOrgNameMatches] = useState<{ organizationId: string; name: string }[]>([]);
  const [orgMatchedBy, setOrgMatchedBy] = useState<'id' | 'name' | null>(null);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);

  // New org details (only when create mode)
  const [orgName, setOrgName] = useState('');
  const [orgLegalName, setOrgLegalName] = useState('');
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
    setSignupNotice(null);
    setEmail('');
    setPassword('');
    setOrganizationId('');
    setSignupMode('join');
    setRequestAdminRole(false);
    setOrgCheckStatus('idle');
    setOrgLookupName(null);
    setOrgLookupError(null);
    setOrgNormalizedId(null);
    setOrgSuggestions([]);
    setOrgSelectedSuggestion(null);
    setOrgNameMatches([]);
    setOrgMatchedBy(null);

    setOrgName('');
    setOrgLegalName('');
    setOrgTaxId('');
    setOrgCountry('');
    setOrgAddress('');
    setOrgBillingEmail('');
    setOrgPhone('');
    setOrgTeamSize('');
  }, [isLoginView]);

  // Check org existence (organizationsPublic) for UX only
  useEffect(() => {
    if (isLoginView || !app) {
      setOrgCheckStatus('idle');
      setOrgLookupName(null);
      setOrgLookupError(null);
      setOrgNormalizedId(null);
      setOrgSuggestions([]);
      setOrgNameMatches([]);
      setOrgMatchedBy(null);
      return;
    }

    const lookupValue = signupMode === 'create' ? orgName.trim() : organizationId.trim();

    if (!lookupValue) {
      setOrgCheckStatus('idle');
      setOrgLookupName(null);
      setOrgLookupError(null);
      setOrgNormalizedId(null);
      setOrgSuggestions([]);
      setOrgNameMatches([]);
      setOrgMatchedBy(null);
      return;
    }

    let cancelled = false;
    setOrgCheckStatus('checking');
    setOrgLookupError(null);

    (async () => {
      try {
        if (signupMode === 'join') {
          const fn = httpsCallable(getFunctions(app, 'us-central1'), 'resolveOrganizationId');
          const res = await fn({ input: lookupValue });
          const payload = res?.data as {
            organizationId?: string | null;
            name?: string | null;
            matchedBy?: 'id' | 'name' | null;
            matches?: { organizationId: string; name: string }[];
          };

          if (cancelled) return;

          const resolvedId = payload?.organizationId ?? null;
          const matches = Array.isArray(payload?.matches) ? payload.matches : [];

          if (resolvedId) {
            setOrgCheckStatus('exists');
            setOrgLookupName(payload?.name ?? null);
            setOrgNormalizedId(resolvedId);
            setOrgMatchedBy(payload?.matchedBy ?? null);
            setOrgNameMatches([]);
          } else if (matches.length > 0) {
            setOrgCheckStatus('exists');
            setOrgLookupName(null);
            setOrgNormalizedId(null);
            setOrgMatchedBy(null);
            setOrgNameMatches(matches);
          } else {
            setOrgCheckStatus('available');
            setOrgLookupName(null);
            setOrgNormalizedId(sanitizedOrgId || null);
            setOrgMatchedBy(null);
            setOrgNameMatches([]);
          }

          setOrgSuggestions([]);
          return;
        }

        const fn = httpsCallable(getFunctions(app, 'us-central1'), 'checkOrganizationAvailability');
        const res = await fn({ organizationId: lookupValue });
        const payload = res?.data as {
          normalizedId?: string;
          available?: boolean;
          suggestions?: string[];
          existingName?: string | null;
        };

        if (cancelled) return;

        const isAvailable = Boolean(payload?.available);
        setOrgCheckStatus(isAvailable ? 'available' : 'exists');
        setOrgLookupName(payload?.existingName ?? null);
        setOrgNormalizedId(payload?.normalizedId ?? null);
        setOrgSuggestions(Array.isArray(payload?.suggestions) ? payload.suggestions : []);
        setOrgSelectedSuggestion(payload?.suggestions?.[0] ?? null);
        setOrgNameMatches([]);
        setOrgMatchedBy(null);
      } catch (err: any) {
        if (cancelled) return;
        setOrgCheckStatus('error');
        setOrgLookupError(err?.message || 'No se pudo comprobar la organización.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [app, isLoginView, organizationId, orgName, sanitizedOrgId, signupMode]);

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

try {
  if (app && auth.currentUser?.emailVerified) {
    const fn = httpsCallable(getFunctions(app, 'us-central1'), 'finalizeOrganizationSignup');
    const res = await fn({});
    const data = res?.data as any;
    if (data?.mode === 'created') {
      router.replace('/');
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

try {
  if (app && auth.currentUser?.emailVerified) {
    const fn = httpsCallable(getFunctions(app, 'us-central1'), 'finalizeOrganizationSignup');
    const res = await fn({});
    const data = res?.data as any;
    if (data?.mode === 'created') {
      router.replace('/');
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
    setSignupNotice(null);

    try {
      let orgId = sanitizedOrgId;

      if (signupMode === 'create') {
        if (!orgName.trim() || !orgCountry.trim()) {
          throw new Error('Para crear una nueva organización debes indicar nombre fiscal y país.');
        }
        const precheck = httpsCallable(getFunctions(app, 'us-central1'), 'checkOrganizationAvailability');
        const res = await precheck({ organizationId: orgName.trim() });
        const payload = res?.data as { available?: boolean; normalizedId?: string; suggestions?: string[] };
        if (!payload?.available) {
          if (orgSelectedSuggestion) {
            orgId = orgSelectedSuggestion;
          } else {
            const suggestions = payload?.suggestions?.length ? ` Sugerencias: ${payload.suggestions.join(', ')}.` : '';
            throw new Error(`Ese ID ya existe. Elige otro ID o cambia a "Unirme a una organización".${suggestions}`);
          }
        }
        orgId = orgSelectedSuggestion ?? String(payload?.normalizedId ?? orgId);
      } else {
        if (!organizationId.trim()) throw new Error('Indica el ID o nombre de la organización.');
        const resolveOrg = httpsCallable(getFunctions(app, 'us-central1'), 'resolveOrganizationId');
        const res = await resolveOrg({ input: organizationId.trim() });
        const payload = res?.data as {
          organizationId?: string | null;
          matches?: { organizationId: string; name: string }[];
        };

        if (!payload?.organizationId) {
          if (payload?.matches?.length) {
            const options = payload.matches
              .map((match) => `${match.name} (${match.organizationId})`)
              .join(', ');
            throw new Error(`Hay varias organizaciones con ese nombre. Usa el ID exacto: ${options}.`);
          }
          throw new Error('No encontramos una organización con ese ID o nombre.');
        }

        orgId = payload.organizationId;
      }

      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      if (signupMode === 'create' && !cred.user.emailVerified) {
        await sendEmailVerification(cred.user);
      }

      const fn = httpsCallable(getFunctions(app), 'bootstrapSignup');

      const requestedRole = requestAdminRole ? 'admin' : 'operator';

      const payload: any = {
        organizationId: orgId,
        requestedRole,
        signupMode,
      };

      if (signupMode === 'create') {
        payload.organizationDetails = {
          name: orgName.trim(),
          legalName: orgLegalName.trim() || null,
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

      if (data?.mode === 'verification_required') {
        setSignupNotice('Revisa tu email para confirmar la creación de la organización y activar tu cuenta.');
        await signOut(auth);
        return;
      }

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
            {signupNotice && (
              <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-900">
                {signupNotice}
              </div>
            )}

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
                      <Label htmlFor="organizationId">ID o nombre de organización (obligatorio)</Label>
                      <Input
                        id="organizationId"
                        placeholder="ej: mi-empresa o Empresa S.A."
                        value={organizationId}
                        onChange={(e) => setOrganizationId(e.target.value)}
                        required
                      />
                      <div className="text-xs text-muted-foreground">
                        {orgCheckStatus === 'checking' && 'Comprobando disponibilidad…'}
                        {orgCheckStatus === 'exists' && orgNameMatches.length === 0 && (
                          <>
                            Organización encontrada:{' '}
                            <b>{orgLookupName ?? orgNormalizedId ?? sanitizedOrgId}</b>
                            {orgMatchedBy === 'name' && orgNormalizedId && (
                              <span> (ID: {orgNormalizedId})</span>
                            )}
                          </>
                        )}
                        {orgCheckStatus === 'exists' && orgNameMatches.length > 0 && (
                          <>
                            Se encontraron varias organizaciones:{' '}
                            <b>{orgNameMatches.map((m) => `${m.name} (${m.organizationId})`).join(', ')}</b>. Usa el ID
                            exacto.
                          </>
                        )}
                        {orgCheckStatus === 'available' && 'No existe una organización con ese ID o nombre.'}
                        {orgCheckStatus === 'error' && (orgLookupError || 'No se pudo comprobar la organización.')}
                      </div>
                    </div>
                  )}

                  {signupMode === 'join' && (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">
                        Puedes introducir el ID o el nombre para solicitar acceso.
                      </div>
                    </div>
                  )}

                  {signupMode === 'join' && (
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
                  )}

                  {signupMode === 'create' && (
                    <div className="rounded-md border p-4 space-y-3">
                      <div className="text-sm font-medium">Datos de la nueva organización</div>

                      <div className="space-y-2">
                        <Label htmlFor="orgName">Nombre de la organización</Label>
                        <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                        <div className="text-xs text-muted-foreground">
                          {orgCheckStatus === 'checking' && 'Comprobando disponibilidad…'}
                          {orgCheckStatus === 'available' && orgNormalizedId && (
                            <>
                              ID sugerido: <b>{orgNormalizedId}</b>
                            </>
                          )}
                          {orgCheckStatus === 'exists' && (
                            <>
                              Ese nombre ya está en uso.
                              {orgSuggestions.length > 0 && (
                                <> Selecciona un ID libre para continuar.</>
                              )}
                            </>
                          )}
                          {orgCheckStatus === 'error' && (orgLookupError || 'No se pudo comprobar la organización.')}
                        </div>
                        {orgCheckStatus === 'exists' && orgSuggestions.length > 0 && (
                          <RadioGroup
                            value={orgSelectedSuggestion ?? ''}
                            onValueChange={(value) => setOrgSelectedSuggestion(value)}
                            className="gap-2"
                          >
                            {orgSuggestions.map((suggestion) => (
                              <div key={suggestion} className="flex items-center space-x-2">
                                <RadioGroupItem id={`suggestion-${suggestion}`} value={suggestion} />
                                <Label htmlFor={`suggestion-${suggestion}`}>{suggestion}</Label>
                              </div>
                            ))}
                          </RadioGroup>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="orgLegalName">Nombre fiscal (opcional)</Label>
                        <Input id="orgLegalName" value={orgLegalName} onChange={(e) => setOrgLegalName(e.target.value)} />
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
  );
}
