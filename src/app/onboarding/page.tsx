'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useUser } from '@/lib/firebase/auth/use-user';
import { sendEmailVerification, signOut } from 'firebase/auth';
import { useAuth, useFirebaseApp } from '@/lib/firebase/provider';
import { getFunctions, httpsCallable } from 'firebase/functions';

type OrgCheckStatus = 'idle' | 'checking' | 'exists' | 'available' | 'error';

type SignupMode = 'demo' | 'join' | 'create';

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuth();
  const app = useFirebaseApp();
  const { user, profile, memberships, organizationId, activeMembership, loading, isRoot } = useUser();
  const [finalizeAttempted, setFinalizeAttempted] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizeLoading, setFinalizeLoading] = useState(false);

  const [signupMode, setSignupMode] = useState<SignupMode>('demo');

  const [organizationIdInput, setOrganizationIdInput] = useState('');
  const [requestAdminRole, setRequestAdminRole] = useState(false);

  const [orgCheckStatus, setOrgCheckStatus] = useState<OrgCheckStatus>('idle');
  const [orgLookupName, setOrgLookupName] = useState<string | null>(null);
  const [orgLookupError, setOrgLookupError] = useState<string | null>(null);
  const [orgNormalizedId, setOrgNormalizedId] = useState<string | null>(null);
  const [orgSuggestions, setOrgSuggestions] = useState<string[]>([]);
  const [orgSelectedSuggestion, setOrgSelectedSuggestion] = useState<string | null>(null);
  const [orgNameMatches, setOrgNameMatches] = useState<{ organizationId: string; name: string }[]>([]);
  const [orgMatchedBy, setOrgMatchedBy] = useState<'id' | 'name' | null>(null);

  // New org details (create mode)
  const [orgName, setOrgName] = useState('');
  const [orgLegalName, setOrgLegalName] = useState('');
  const [orgTaxId, setOrgTaxId] = useState('');
  const [orgCountry, setOrgCountry] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgBillingEmail, setOrgBillingEmail] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgTeamSize, setOrgTeamSize] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [quotaRequiresUpgrade, setQuotaRequiresUpgrade] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  const sanitizedOrgId = useMemo(
    () => String(organizationIdInput ?? '').trim().toLowerCase(),
    [organizationIdInput]
  );

  const hasActiveMembership = memberships.some((membership) => membership.status === 'active');
  const hasPendingMembership = memberships.some((membership) => membership.status !== 'active');

  const allowCreate = searchParams.get('mode') === 'create';

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (isRoot) {
      router.replace('/root');
      return;
    }
    if (!allowCreate && (hasActiveMembership || organizationId || activeMembership?.status === 'active')) {
      router.replace('/');
    }
  }, [activeMembership, allowCreate, hasActiveMembership, isRoot, loading, organizationId, router, user]);

  const attemptFinalize = async () => {
    if (!app || !auth?.currentUser) return;
    setFinalizeError(null);
    setFinalizeLoading(true);
    try {
      await auth.currentUser.reload();
      if (!auth.currentUser.emailVerified) {
        setFinalizeError('El correo todavía no está verificado.');
        return;
      }
      const fn = httpsCallable(getFunctions(app, 'us-central1'), 'finalizeOrganizationSignup');
      await fn({});
      router.refresh();
    } catch (err: any) {
      setFinalizeError(err?.message || 'No se pudo completar el alta. Intenta de nuevo.');
    } finally {
      setFinalizeLoading(false);
    }
  };

  useEffect(() => {
    if (!app || !auth || !user || profile || finalizeAttempted) return;

    setFinalizeAttempted(true);
    void attemptFinalize();
  }, [app, auth, user, profile, finalizeAttempted]);

  useEffect(() => {
    setError(null);
    setNotice(null);
    setOrgCheckStatus('idle');
    setOrgLookupName(null);
    setOrgLookupError(null);
    setOrgNormalizedId(null);
    setOrgSuggestions([]);
    setOrgSelectedSuggestion(null);
    setOrgNameMatches([]);
    setOrgMatchedBy(null);
  }, [signupMode]);

  // Check org existence (organizationsPublic) for UX only
  useEffect(() => {
    if (!app || signupMode === 'demo') {
      setOrgCheckStatus('idle');
      setOrgLookupName(null);
      setOrgLookupError(null);
      setOrgNormalizedId(null);
      setOrgSuggestions([]);
      setOrgNameMatches([]);
      setOrgMatchedBy(null);
      return;
    }

    const lookupValue = signupMode === 'create' ? orgName.trim() : organizationIdInput.trim();

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
  }, [app, orgName, organizationIdInput, sanitizedOrgId, signupMode]);

  const doLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    router.replace('/login');
  };

  const handleSignupError = (err: any, fallbackMessage: string) => {
    const rawCode = String(err?.code ?? '');
    const code = rawCode.startsWith('functions/') ? rawCode.replace('functions/', '') : rawCode;
    const message = String(err?.message ?? fallbackMessage);
    const normalizedMessage = message.toLowerCase();
    const isQuotaError = code === 'failed-precondition' && (normalizedMessage.includes('límite') || normalizedMessage.includes('demo'));
    const requiresUpgrade = code === 'failed-precondition' && normalizedMessage.includes('límite de organizaciones');

    setQuotaBlocked(isQuotaError);
    setQuotaRequiresUpgrade(requiresUpgrade);
    setError(message || fallbackMessage);
  };

  const runSignup = async (mode: Exclude<SignupMode, 'demo'>) => {
    if (!auth || !app) return;

    setLoadingAction(true);
    setError(null);
    setNotice(null);
    setQuotaBlocked(false);
    setQuotaRequiresUpgrade(false);

    try {
      let orgId = sanitizedOrgId;

      if (mode === 'create') {
        if (!orgName.trim() || !orgCountry.trim()) {
          throw new Error('Para crear una nueva organización debes indicar nombre y país.');
        }
        const precheck = httpsCallable(getFunctions(app, 'us-central1'), 'checkOrganizationAvailability');
        const res = await precheck({ organizationId: orgName.trim() });
        const payload = res?.data as { available?: boolean; normalizedId?: string; suggestions?: string[] };
        if (!payload?.available) {
          if (orgSelectedSuggestion) {
            orgId = orgSelectedSuggestion;
          } else {
            const suggestions = payload?.suggestions?.length
              ? ` Sugerencias: ${payload.suggestions.join(', ')}.`
              : '';
            throw new Error(`Ese ID ya existe. Elige otro ID.${suggestions}`);
          }
        }
        orgId = orgSelectedSuggestion ?? String(payload?.normalizedId ?? orgId);

        if (auth.currentUser && !auth.currentUser.emailVerified) {
          await sendEmailVerification(auth.currentUser);
        }
      } else {
        if (!organizationIdInput.trim()) throw new Error('Indica el ID o nombre de la organización.');
        const resolveOrg = httpsCallable(getFunctions(app, 'us-central1'), 'resolveOrganizationId');
        const res = await resolveOrg({ input: organizationIdInput.trim() });
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

      const fn = httpsCallable(getFunctions(app), 'bootstrapSignup');
      const requestedRole = requestAdminRole ? 'admin' : 'operator';

      const payload: any = {
        organizationId: orgId,
        requestedRole,
        signupMode: mode,
      };

      if (mode === 'create') {
        payload.organizationDetails = {
          name: orgName.trim(),
          legalName: orgLegalName.trim() || null,
          taxId: orgTaxId.trim() || null,
          country: orgCountry.trim(),
          address: orgAddress.trim() || null,
          billingEmail: (orgBillingEmail.trim() || user?.email?.trim()) ?? null,
          phone: orgPhone.trim() || null,
          teamSize: orgTeamSize ? Number(orgTeamSize) : null,
        };
      }

      const res = await fn(payload);
      const data = res?.data as any;

      if (data?.mode === 'verification_required') {
        setNotice('Revisa tu email para confirmar la creación de la organización y activar tu cuenta.');
        return;
      }

      if (data?.mode === 'pending') {
        router.replace('/onboarding');
      } else {
        router.replace('/');
      }
    } catch (err: any) {
      handleSignupError(err, 'No se pudo completar el alta.');
    } finally {
      setLoadingAction(false);
    }
  };

  const startDemo = async () => {
    if (!auth || !app || !user) return;

    setLoadingAction(true);
    setError(null);
    setNotice(null);
    setQuotaBlocked(false);
    setQuotaRequiresUpgrade(false);

    try {
      if (auth.currentUser && !auth.currentUser.emailVerified) {
        await sendEmailVerification(auth.currentUser);
      }

      const demoSuffix = Date.now().toString(36);
      const demoOrgId = `demo-${user.uid.slice(0, 6).toLowerCase()}-${demoSuffix}`;
      const fn = httpsCallable(getFunctions(app), 'bootstrapSignup');
      const res = await fn({
        organizationId: demoOrgId,
        requestedRole: 'super_admin',
        signupMode: 'create',
        organizationDetails: {
          name: `Demo de ${user.email ?? 'usuario'}`,
          legalName: null,
          taxId: null,
          country: orgCountry.trim() || 'ES',
          address: null,
          billingEmail: user.email ?? null,
          phone: null,
          teamSize: null,
        },
      });
      const data = res?.data as any;

      if (data?.mode === 'verification_required') {
        setNotice('Revisa tu email para activar la demo.');
        return;
      }

      router.replace('/');
    } catch (err: any) {
      handleSignupError(err, 'No se pudo iniciar la demo.');
    } finally {
      setLoadingAction(false);
    }
  };

  useEffect(() => {
    if (allowCreate) {
      setSignupMode('create');
    }
  }, [allowCreate]);

  const pendingMembership = memberships.find((membership) => membership.status !== 'active') ?? null;
  const pending = Boolean(pendingMembership);
  const showSelection = Boolean(
    user && !pending && (allowCreate || (!hasActiveMembership && !organizationId))
  );

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Acceso a la organización</CardTitle>
            <CardDescription>
              Elige cómo quieres continuar: demo, solicitar acceso o crear tu propia organización.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!user && <p>Redirigiendo a login…</p>}

            {finalizeError && <p className="text-sm text-destructive">{finalizeError}</p>}

            {notice && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-900">
                {notice}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p>{error}</p>
                {quotaBlocked && (
                  <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                    <p>
                      Puedes seguir trabajando creando <b>Ubicaciones</b> dentro de tu organización actual.
                    </p>
                    {quotaRequiresUpgrade && (
                      <Button variant="outline" size="sm" onClick={() => router.push('/settings')}>
                        Actualizar plan de cuenta
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {user && !profile && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                <p>Tu cuenta está autenticada, pero todavía no has completado el alta de organización.</p>
                <p>Si ya has verificado el correo, reintenta la validación.</p>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={attemptFinalize} disabled={finalizeLoading}>
                    {finalizeLoading ? 'Validando…' : 'Reintentar validación'}
                  </Button>
                  <Button variant="outline" onClick={doLogout}>
                    Cerrar sesión
                  </Button>
                </div>
              </div>
            )}

            {user && profile && pending && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                <p>
                  Tu solicitud para unirte a la organización{' '}
                  <b>{pendingMembership?.organizationName || pendingMembership?.organizationId}</b> está pendiente de
                  aprobación.
                </p>
                <p>En cuanto un super administrador apruebe la solicitud, podrás acceder automáticamente.</p>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => router.refresh()}>Actualizar</Button>
                  <Button variant="outline" onClick={doLogout}>
                    Cerrar sesión
                  </Button>
                </div>
              </div>
            )}

            {showSelection && (
              <div className="space-y-6">
                {!allowCreate && (
                  <RadioGroup
                    value={signupMode}
                    onValueChange={(v) => setSignupMode(v as SignupMode)}
                    className="gap-3"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem id="demo" value="demo" />
                      <Label htmlFor="demo">Probar versión demo</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem id="join" value="join" />
                      <Label htmlFor="join">Solicitar acceso a una organización existente</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem id="create" value="create" />
                      <Label htmlFor="create">Crear una organización nueva</Label>
                    </div>
                  </RadioGroup>
                )}

                {!allowCreate && signupMode === 'demo' && (
                  <div className="rounded-md border p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Crea una demo rápida para explorar la plataforma con datos de ejemplo.
                    </p>
                    <Button onClick={startDemo} disabled={loadingAction}>
                      {loadingAction ? 'Creando demo…' : 'Iniciar demo'}
                    </Button>
                  </div>
                )}

                {!allowCreate && signupMode === 'join' && (
                  <div className="rounded-md border p-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="organizationId">ID o nombre de organización (obligatorio)</Label>
                      <Input
                        id="organizationId"
                        placeholder="ej: mi-empresa o Empresa S.A."
                        value={organizationIdInput}
                        onChange={(e) => setOrganizationIdInput(e.target.value)}
                        required
                      />
                      <div className="text-xs text-muted-foreground">
                        {orgCheckStatus === 'checking' && 'Comprobando disponibilidad…'}
                        {orgCheckStatus === 'exists' && orgNameMatches.length === 0 && (
                          <>
                            Organización encontrada:{' '}
                            <b>{orgLookupName ?? orgNormalizedId ?? sanitizedOrgId}</b>
                            {orgMatchedBy === 'name' && orgNormalizedId && <span> (ID: {orgNormalizedId})</span>}
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

                    <Button onClick={() => runSignup('join')} disabled={loadingAction}>
                      {loadingAction ? 'Enviando…' : 'Solicitar acceso'}
                    </Button>
                  </div>
                )}

                {signupMode === 'create' && (
                  <div className="rounded-md border p-4 space-y-4">
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
                            {orgSuggestions.length > 0 && <> Selecciona un ID libre para continuar.</>}
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

                    <Button onClick={() => runSignup('create')} disabled={loadingAction}>
                      {loadingAction ? 'Creando…' : 'Crear organización'}
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={doLogout}>
                    Cerrar sesión
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
