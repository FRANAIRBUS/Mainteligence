import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import type { Request, Response } from 'express';
import { sendAssignmentEmail } from './assignment-email';
import { sendInviteEmail } from './invite-email';
import { canCreate, isFeatureEnabled } from './entitlements';
import * as crypto from 'crypto';
import * as https from 'https';
import type { IncomingMessage } from 'http';

admin.initializeApp();
const db = admin.firestore();



type Role =
  | 'super_admin'
  | 'admin'
  | 'mantenimiento'
  | 'jefe_departamento'
  | 'jefe_ubicacion'
  | 'operario'
  | 'auditor';

type AccountPlan = 'free' | 'personal_plus' | 'business_creator' | 'enterprise';
type EntitlementPlanId = 'free' | 'basic' | 'starter' | 'pro' | 'enterprise';
type EntitlementStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
type EntitlementProvider = 'stripe' | 'google_play' | 'apple_app_store' | 'manual';
type OrganizationStatus = 'active' | 'suspended' | 'deleted';

type EntitlementLimits = {
  maxSites: number;
  maxAssets: number;
  maxDepartments: number;
  maxUsers: number;
  maxActivePreventives: number;
  attachmentsMonthlyMB: number;
  maxOpenTickets: number;
  maxOpenTasks: number;
  maxAttachmentMB: number;
  maxAttachmentsPerTicket: number;
  retentionDays: number;
};

type EntitlementUsage = {
  sitesCount: number;
  assetsCount: number;
  departmentsCount: number;
  usersCount: number;
  activePreventivesCount: number;
  attachmentsThisMonthMB: number;
  openTicketsCount: number;
  openTasksCount: number;
};

type Entitlement = {
  planId: EntitlementPlanId;
  status: EntitlementStatus;
  provider: EntitlementProvider;
  trialEndsAt?: admin.firestore.Timestamp;
  currentPeriodEnd?: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  limits: EntitlementLimits;
  usage: EntitlementUsage;
};

type BillingProviderEntitlement = {
  planId: EntitlementPlanId;
  status: EntitlementStatus;
  trialEndsAt?: admin.firestore.Timestamp;
  currentPeriodEnd?: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  conflict?: boolean;
  conflictReason?: string;
};

const DEFAULT_ACCOUNT_PLAN: AccountPlan = 'free';
const DEFAULT_ENTERPRISE_LIMIT = 10;
const CREATED_ORG_LIMITS: Record<AccountPlan, number> = {
  free: 1,
  personal_plus: 2,
  business_creator: 3,
  enterprise: DEFAULT_ENTERPRISE_LIMIT,
};

const DEFAULT_ENTITLEMENT_PROVIDER: EntitlementProvider = 'manual';

const PLAN_DEFAULT_LIMITS: Record<EntitlementPlanId, EntitlementLimits> = {
  free: {
    maxUsers: 2,
    maxSites: 1,
    maxDepartments: 3,
    maxAssets: 1,
    maxActivePreventives: 0,
    maxOpenTickets: 10,
    maxOpenTasks: 10,
    attachmentsMonthlyMB: 0,
    maxAttachmentMB: 0,
    maxAttachmentsPerTicket: 0,
    retentionDays: 0,
  },
  basic: {
    maxUsers: 5,
    maxSites: 2,
    maxDepartments: 5,
    maxAssets: 5,
    maxActivePreventives: 0,
    maxOpenTickets: 50,
    maxOpenTasks: 50,
    attachmentsMonthlyMB: 0,
    maxAttachmentMB: 0,
    maxAttachmentsPerTicket: 0,
    retentionDays: 0,
  },
  starter: {
    maxUsers: 10,
    maxSites: 5,
    maxDepartments: 15,
    maxAssets: 200,
    maxActivePreventives: 50,
    maxOpenTickets: 200,
    maxOpenTasks: 200,
    attachmentsMonthlyMB: 500,
    maxAttachmentMB: 10,
    maxAttachmentsPerTicket: 10,
    retentionDays: 180,
  },
  pro: {
    maxUsers: 25,
    maxSites: 15,
    maxDepartments: 50,
    maxAssets: 1000,
    maxActivePreventives: 250,
    maxOpenTickets: 1000,
    maxOpenTasks: 1000,
    attachmentsMonthlyMB: 5000,
    maxAttachmentMB: 25,
    maxAttachmentsPerTicket: 25,
    retentionDays: 365,
  },
  enterprise: {
    maxUsers: 10_000,
    maxSites: 10_000,
    maxDepartments: 10_000,
    maxAssets: 1_000_000,
    maxActivePreventives: 100_000,
    maxOpenTickets: 1_000_000,
    maxOpenTasks: 1_000_000,
    attachmentsMonthlyMB: 100_000,
    maxAttachmentMB: 100,
    maxAttachmentsPerTicket: 100,
    retentionDays: 3650,
  },
};

const PLAN_DEFAULT_FEATURES: Record<EntitlementPlanId, Record<'EXPORT_PDF' | 'AUDIT_TRAIL' | 'PREVENTIVES', boolean>> = {
  free: {
    EXPORT_PDF: false,
    AUDIT_TRAIL: false,
    PREVENTIVES: false,
  },
  basic: {
    EXPORT_PDF: false,
    AUDIT_TRAIL: false,
    PREVENTIVES: false,
  },
  starter: {
    EXPORT_PDF: true,
    AUDIT_TRAIL: false,
    PREVENTIVES: true,
  },
  pro: {
    EXPORT_PDF: true,
    AUDIT_TRAIL: true,
    PREVENTIVES: true,
  },
  enterprise: {
    EXPORT_PDF: true,
    AUDIT_TRAIL: true,
    PREVENTIVES: true,
  },
};

const DEFAULT_ENTITLEMENT_USAGE: EntitlementUsage = {
  sitesCount: 0,
  assetsCount: 0,
  departmentsCount: 0,
  usersCount: 0,
  activePreventivesCount: 0,
  attachmentsThisMonthMB: 0,
  openTicketsCount: 0,
  openTasksCount: 0,
};

const DEMO_PREVENTIVE_TEMPLATES_LIMIT = 5;

// Basic rentable org settings (Pro-ready).
// Stored in organizations/{orgId}/settings/main.
const DEFAULT_ORG_SETTINGS_MAIN = {
  allowScopeMembersToViewOpsTasks: true,
  allowScopeMembersToCompleteOpsTasks: true,
  validationModeEnabled: false,
  reopenWindowHours: 48,
};

type MembershipScope = {
  departmentId?: string;
  departmentIds: string[];
  locationId?: string;
  locationIds: string[];
};

type ResolvedMembership = {
  role: Role;
  status: string;
  scope: MembershipScope;
  membershipData: FirebaseFirestore.DocumentData | null;
  userData: FirebaseFirestore.DocumentData | null;
};

const ADMIN_LIKE_ROLES = new Set<Role>(['super_admin', 'admin', 'mantenimiento']);
const SCOPED_HEAD_ROLES = new Set<Role>(['jefe_departamento', 'jefe_ubicacion', 'operario']);
const MASTER_DATA_ROLES = new Set<Role>([...ADMIN_LIKE_ROLES, ...SCOPED_HEAD_ROLES]);
const TASKS_ROLES = new Set<Role>([...ADMIN_LIKE_ROLES, ...SCOPED_HEAD_ROLES]);

const USAGE_FIELDS: Record<'sites' | 'assets' | 'departments' | 'users' | 'preventives', keyof EntitlementUsage> = {
  sites: 'sitesCount',
  assets: 'assetsCount',
  departments: 'departmentsCount',
  users: 'usersCount',
  preventives: 'activePreventivesCount',
};

const LIMIT_MESSAGES: Record<keyof typeof USAGE_FIELDS, string> = {
  sites: 'Has alcanzado el límite de ubicaciones de tu plan. Contacta para ampliarlo.',
  assets: 'Has alcanzado el límite de activos de tu plan. Contacta para ampliarlo.',
  departments: 'Has alcanzado el límite de departamentos de tu plan. Contacta para ampliarlo.',
  users: 'Has alcanzado el límite de usuarios de tu plan. Contacta para ampliarlo.',
  preventives: 'Has alcanzado el límite de preventivos activos de tu plan. Contacta para ampliarlo.',
};

type PreventiveScheduleType = 'daily' | 'weekly' | 'monthly' | 'date';
type PreventiveTemplateStatus = 'active' | 'paused' | 'archived';

type PreventiveSchedule = {
  type: PreventiveScheduleType;
  timezone?: string;
  timeOfDay?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  date?: admin.firestore.Timestamp;
  nextRunAt?: admin.firestore.Timestamp;
  lastRunAt?: admin.firestore.Timestamp;
};

type PreventiveTemplate = {
  name: string;
  description?: string;
  status: PreventiveTemplateStatus;
  pausedReason?: string;
  automatic: boolean;
  schedule: PreventiveSchedule;
  priority?: string;
  siteId?: string;
  departmentId?: string;
  assetId?: string;
  checklist?: unknown[];
  createdBy?: string;
  organizationId?: string;
};

function buildEntitlementPayload({
  planId,
  status,
  trialEndsAt,
  currentPeriodEnd,
  provider = DEFAULT_ENTITLEMENT_PROVIDER,
  now,
  limits,
  usage = DEFAULT_ENTITLEMENT_USAGE,
}: {
  planId: EntitlementPlanId;
  status: EntitlementStatus;
  trialEndsAt?: admin.firestore.Timestamp | null;
  currentPeriodEnd?: admin.firestore.Timestamp | null;
  provider?: EntitlementProvider;
  now: admin.firestore.FieldValue;
  limits?: EntitlementLimits;
  usage?: EntitlementUsage;
}) {
  const resolvedLimits = resolveEffectiveLimitsForPlan(planId, limits ?? null);

  const payload: Record<string, unknown> = {
    planId,
    status,
    provider,
    updatedAt: now,
    limits: resolvedLimits,
    usage,
  };

  if (trialEndsAt) {
    payload.trialEndsAt = trialEndsAt;
  }

  if (currentPeriodEnd) {
    payload.currentPeriodEnd = currentPeriodEnd;
  }

  return payload;
}

function httpsError(code: functions.https.FunctionsErrorCode, message: string) {
  return new functions.https.HttpsError(code, message);
}

function resolveTemplateOrgId(docRef: FirebaseFirestore.DocumentReference, data?: PreventiveTemplate) {
  const dataOrgId = String(data?.organizationId ?? '').trim();
  if (dataOrgId) return dataOrgId;
  const match = docRef.path.match(/^organizations\/([^/]+)\//);
  return match?.[1] ?? '';
}

function resolveZonedDate(timeZone?: string) {
  if (!timeZone) return new Date();
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone }));
  } catch {
    return new Date();
  }
}

function parseTimeOfDay(timeOfDay?: string) {
  if (!timeOfDay) return { hours: 8, minutes: 0 };
  const [rawHours, rawMinutes] = timeOfDay.split(':');
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  return {
    hours: Number.isFinite(hours) ? hours : 8,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

function computeNextRunAt(schedule: PreventiveSchedule, now: Date) {
  const { hours, minutes } = parseTimeOfDay(schedule.timeOfDay);
  const base = new Date(now);

  switch (schedule.type) {
    case 'daily': {
      const candidate = new Date(base);
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate <= now) {
        candidate.setDate(candidate.getDate() + 1);
      }
      return candidate;
    }
    case 'weekly': {
      const days = schedule.daysOfWeek?.length ? schedule.daysOfWeek : [base.getDay() || 7];
      const normalizedDays = days
        .map((day) => (day === 7 ? 7 : day))
        .filter((day) => day >= 1 && day <= 7);
      for (let offset = 0; offset <= 7; offset += 1) {
        const candidate = new Date(base);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(hours, minutes, 0, 0);
        const weekday = candidate.getDay() === 0 ? 7 : candidate.getDay();
        if (normalizedDays.includes(weekday) && candidate > now) {
          return candidate;
        }
      }
      const fallback = new Date(base);
      fallback.setDate(fallback.getDate() + 7);
      fallback.setHours(hours, minutes, 0, 0);
      return fallback;
    }
    case 'monthly': {
      const day = schedule.dayOfMonth ?? base.getDate();
      const candidate = new Date(base);
      candidate.setDate(day);
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate <= now) {
        candidate.setMonth(candidate.getMonth() + 1);
        candidate.setDate(day);
      }
      return candidate;
    }
    case 'date': {
      if (!schedule.date) return null;
      return schedule.date.toDate();
    }
    default:
      return null;
  }
}

function resolveFrequencyDays(schedule: PreventiveSchedule) {
  switch (schedule.type) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    default:
      return 0;
  }
}

const ALLOWED_CORS_ORIGINS = new Set([
  'https://multi.maintelligence.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const STRIPE_API_VERSION = '2023-10-16';
const APPLE_UPDATES_ENABLED = (process.env.APPLE_APP_STORE_APPLY_UPDATES ?? 'false') === 'true';

type StripeRuntimeConfig = { secretKey: string; webhookSecret: string };
function resolveStripeConfig(): StripeRuntimeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) return null;
  return { secretKey, webhookSecret };
}

type GooglePlayRuntimeConfig = { clientEmail: string; privateKey: string; packageName: string };
function resolveGooglePlayConfig(): GooglePlayRuntimeConfig | null {
  const clientEmail = process.env.GOOGLE_PLAY_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_PLAY_PRIVATE_KEY;
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME ?? '';

  if (!clientEmail || !privateKeyRaw) return null;

  return {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
    packageName,
  };
}

type AppleAppStoreRuntimeConfig = { bundleId: string };
function resolveAppleAppStoreConfig(): AppleAppStoreRuntimeConfig {
  const bundleId = process.env.APPLE_APP_STORE_BUNDLE_ID ?? '';
  return { bundleId };
}
type StripeEvent = {
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

type StripeSubscription = {
  id: string;
  status: string;
  current_period_end?: number | null;
  trial_end?: number | null;
  metadata?: Record<string, string | null | undefined>;
};

type StripeCheckoutSession = {
  metadata?: Record<string, string | null | undefined>;
  subscription?: string | { id: string };
};

type AppleNotificationPayload = {
  notificationType?: string;
  subtype?: string | null;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    appAccountToken?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
};

type AppleTransactionPayload = {
  appAccountToken?: string;
  expiresDate?: number;
};

type AppleRenewalPayload = {
  appAccountToken?: string;
  autoRenewStatus?: number;
};

function resolveEntitlementStatusFromStripe(status: string): EntitlementStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return 'past_due';
  }
}

function resolveEntitlementPlanId({
  metadataPlanId,
  fallbackPlanId,
}: {
  metadataPlanId?: string | null;
  fallbackPlanId?: string;
}): EntitlementPlanId {
  const resolvePlanAlias = (planId: string): EntitlementPlanId | null => {
    if (planId.startsWith('free')) return 'free';
    if (planId.startsWith('basic')) return 'basic';
    if (planId.startsWith('standard')) return 'starter';
    if (planId.startsWith('starter')) return 'starter';
    if (planId.startsWith('pro')) return 'pro';
    if (planId.startsWith('enterprise')) return 'enterprise';
    return null;
  };

  const normalized = String(metadataPlanId ?? '').trim().toLowerCase();
  if (normalized === 'free' || normalized === 'basic' || normalized === 'starter' || normalized === 'pro' || normalized === 'enterprise') {
    return normalized as EntitlementPlanId;
  }
  const alias = resolvePlanAlias(normalized);
  if (alias) return alias;
  const fallbackNormalized = String(fallbackPlanId ?? '').trim().toLowerCase();
  if (
    fallbackNormalized === 'free' ||
    fallbackNormalized === 'basic' ||
    fallbackNormalized === 'starter' ||
    fallbackNormalized === 'pro' ||
    fallbackNormalized === 'enterprise'
  ) {
    return fallbackNormalized as EntitlementPlanId;
  }
  const fallbackAlias = resolvePlanAlias(fallbackNormalized);
  if (fallbackAlias) return fallbackAlias;
  return 'free';
}

function resolveDefaultLimitsForPlan(planId: EntitlementPlanId): EntitlementLimits {
  return PLAN_DEFAULT_LIMITS[planId] ?? PLAN_DEFAULT_LIMITS.free;
}

function resolveDefaultFeaturesForPlan(planId: EntitlementPlanId): Record<string, boolean> {
  return PLAN_DEFAULT_FEATURES[planId] ?? PLAN_DEFAULT_FEATURES.free;
}

function resolveEffectiveLimitsForPlan(planId: EntitlementPlanId, limits?: Partial<EntitlementLimits> | null): EntitlementLimits {
  const defaults = resolveDefaultLimitsForPlan(planId);
  if (!limits) return defaults;

  const coalesceLimit = (key: keyof EntitlementLimits) => {
    const rawValue = limits[key];
    if (typeof rawValue !== 'number') {
      return defaults[key];
    }
    if (rawValue <= 0 && defaults[key] > 0 && !['free', 'basic'].includes(planId)) {
      return defaults[key];
    }
    if (rawValue < defaults[key] && !['free', 'basic'].includes(planId)) {
      return defaults[key];
    }
    return rawValue;
  };

  return {
    maxUsers: coalesceLimit('maxUsers'),
    maxSites: coalesceLimit('maxSites'),
    maxDepartments: coalesceLimit('maxDepartments'),
    maxAssets: coalesceLimit('maxAssets'),
    maxActivePreventives: coalesceLimit('maxActivePreventives'),
    maxOpenTickets: coalesceLimit('maxOpenTickets'),
    maxOpenTasks: coalesceLimit('maxOpenTasks'),
    attachmentsMonthlyMB: coalesceLimit('attachmentsMonthlyMB'),
    maxAttachmentMB: coalesceLimit('maxAttachmentMB'),
    maxAttachmentsPerTicket: coalesceLimit('maxAttachmentsPerTicket'),
    retentionDays: coalesceLimit('retentionDays'),
  };
}

function hasPlanChanged(currentPlanId: EntitlementPlanId | undefined, nextPlanId: EntitlementPlanId): boolean {
  if (!currentPlanId) return true;
  return resolveEntitlementPlanId({ metadataPlanId: currentPlanId }) !== nextPlanId;
}

function resolveEffectiveFeaturesForPlan(planId: EntitlementPlanId, features?: Record<string, boolean> | null): Record<string, boolean> {
  return {
    ...resolveDefaultFeaturesForPlan(planId),
    ...(features ?? {}),
  };
}

function resolveEntitlementStatusFromApple(notificationType?: string, renewal?: AppleRenewalPayload | null): EntitlementStatus {
  switch (String(notificationType ?? '').toUpperCase()) {
    case 'DID_RENEW':
    case 'DID_RECOVER':
    case 'DID_CHANGE_RENEWAL_PREF':
      return 'active';
    case 'DID_FAIL_TO_RENEW':
      return 'past_due';
    case 'EXPIRED':
    case 'REFUND':
    case 'REVOKE':
      return 'canceled';
    case 'DID_CHANGE_RENEWAL_STATUS':
      if (renewal && renewal.autoRenewStatus === 0) return 'past_due';
      return 'active';
    default:
      return 'past_due';
  }
}

function resolveOrganizationStatus(input: unknown): OrganizationStatus | null {
  const normalized = String(input ?? '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'suspended' || normalized === 'deleted') {
    return normalized;
  }
  return null;
}

function resolveEntitlementStatus(input: unknown): EntitlementStatus | null {
  const normalized = String(input ?? '').trim().toLowerCase();
  if (normalized === 'trialing' || normalized === 'active' || normalized === 'past_due' || normalized === 'canceled') {
    return normalized;
  }
  return null;
}

function shouldBlockProviderUpdate(entitlement: Entitlement | undefined, incomingProvider: EntitlementProvider): boolean {
  if (!entitlement?.provider) return false;
  if (entitlement.provider === incomingProvider) return false;
  return entitlement.status === 'active' || entitlement.status === 'trialing';
}

function buildConflictPayload({
  planId,
  status,
  now,
  reason,
}: {
  planId: EntitlementPlanId;
  status: EntitlementStatus;
  now: admin.firestore.FieldValue;
  reason: string;
}): Record<string, unknown> {
  return {
    planId,
    status,
    updatedAt: now,
    conflict: true,
    conflictReason: reason,
  };
}

function toTimestampFromMillis(value?: string | number | null): admin.firestore.Timestamp | null {
  if (value == null) return null;
  const millis = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return admin.firestore.Timestamp.fromMillis(millis);
}

function decodeJwtPayload<T>(token?: string | null): T | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const buffer = Buffer.from(`${normalized}${padding}`, 'base64');
  try {
    return JSON.parse(buffer.toString('utf8')) as T;
  } catch {
    return null;
  }
}

function verifyStripeSignature({
  payload,
  signatureHeader,
  webhookSecret,
}: {
  payload: string;
  signatureHeader: string;
  webhookSecret: string;
}): boolean {
  const elements = signatureHeader.split(',');
  const timestampElement = elements.find((entry) => entry.startsWith('t='));
  const signatureElements = elements.filter((entry) => entry.startsWith('v1='));
  if (!timestampElement || signatureElements.length === 0) return false;

  const timestamp = timestampElement.replace('t=', '');
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  return signatureElements.some((entry) => {
    const signature = entry.replace('v1=', '');
    const signatureBuffer = Buffer.from(signature, 'utf8');
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });
}

async function fetchStripeSubscription(subscriptionId: string, secretKey: string): Promise<StripeSubscription> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path: `/v1/subscriptions/${subscriptionId}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Stripe-Version': STRIPE_API_VERSION,
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body) as StripeSubscription);
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(new Error(`Stripe subscription fetch failed: ${res.statusCode ?? 'unknown'} ${body}`));
        });
      }
    );

    req.on('error', (error: Error) => {
      reject(error);
    });
    req.end();
  });
}

async function updateOrganizationStripeEntitlement({
  orgId,
  planId,
  status,
  trialEndsAt,
  currentPeriodEnd,
}: {
  orgId: string;
  planId?: EntitlementPlanId;
  status: EntitlementStatus;
  trialEndsAt?: admin.firestore.Timestamp | null;
  currentPeriodEnd?: admin.firestore.Timestamp | null;
}) {
  const orgRef = db.collection('organizations').doc(orgId);
  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) {
      throw new Error(`Organization ${orgId} not found.`);
    }

    const orgData = orgSnap.data() as { entitlement?: Entitlement } | undefined;
    const entitlement = orgData?.entitlement;
    const usage = entitlement?.usage ?? DEFAULT_ENTITLEMENT_USAGE;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const resolvedPlanId = resolveEntitlementPlanId({
      metadataPlanId: planId ?? null,
      fallbackPlanId: entitlement?.planId,
    });
    const limits = resolveEffectiveLimitsForPlan(
      resolvedPlanId,
      hasPlanChanged(entitlement?.planId, resolvedPlanId) ? null : entitlement?.limits
    );

    const shouldBlock = shouldBlockProviderUpdate(entitlement, 'stripe');
    const billingProviderPayload: Record<string, unknown> = shouldBlock
      ? buildConflictPayload({
          planId: resolvedPlanId,
          status,
          now,
          reason: `active_provider_${entitlement?.provider ?? 'unknown'}`,
        })
      : {
          planId: resolvedPlanId,
          status,
          updatedAt: now,
        };

    if (trialEndsAt) {
      billingProviderPayload.trialEndsAt = trialEndsAt;
    }

    if (currentPeriodEnd) {
      billingProviderPayload.currentPeriodEnd = currentPeriodEnd;
    }

    const updatePayload: Record<string, unknown> = {
      billingProviders: {
        stripe: billingProviderPayload,
      },
      updatedAt: now,
    };

    if (!shouldBlock) {
      updatePayload.entitlement = buildEntitlementPayload({
        planId: resolvedPlanId,
        status,
        trialEndsAt,
        currentPeriodEnd,
        provider: 'stripe',
        now,
        limits,
        usage,
      });
    }

    tx.set(orgRef, updatePayload, { merge: true });
  });
}

function applyCors(req: Request, res: Response): boolean {
  const origin = String(req.headers.origin ?? '');
  if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
  } else {
    res.set('Access-Control-Allow-Origin', 'https://multi.maintelligence.app');
  }
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const requestedHeaders = req.headers['access-control-request-headers'];
  res.set(
    'Access-Control-Allow-Headers',
    typeof requestedHeaders === 'string' && requestedHeaders.trim()
      ? requestedHeaders
      : 'Content-Type, Authorization'
  );
  res.set('Access-Control-Max-Age', '3600');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }

  return false;
}

async function requireAuthFromRequest(req: Request) {
  const authHeader = String(req.headers.authorization ?? '');
  const match = authHeader.match(/^Bearer (.+)$/i);
  if (!match) throw httpsError('unauthenticated', 'Debes iniciar sesión.');
  return admin.auth().verifyIdToken(match[1]);
}

async function updateOrganizationUserProfile({
  actorUid,
  actorEmail,
  isRoot,
  orgId,
  targetUid,
  displayName,
  email,
  departmentId,
  locationId,
}: {
  actorUid: string;
  actorEmail: string | null;
  isRoot: boolean;
  orgId: string;
  targetUid: string;
  displayName: string;
  email: string;
  departmentId: string;
  locationId: string;
}) {
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!targetUid) throw httpsError('invalid-argument', 'uid requerido.');

  if (!isRoot) {
    await requireCallerSuperAdminInOrg(actorUid, orgId);
  }

  const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) {
    throw httpsError('failed-precondition', 'El usuario objetivo no tiene membresía en esa organización.');
  }
  const membership = membershipSnap.data() as any;
  const rawStatus = String(membership?.status ?? '').trim().toLowerCase();
  const membershipStatus =
    rawStatus || (typeof membership?.active === 'boolean' ? (membership.active ? 'active' : 'inactive') : '');
  if (membershipStatus !== 'active') {
    if (membershipStatus === 'pending' || membershipStatus === 'revoked') {
      console.warn('updateOrganizationUserProfile blocked for inactive membership', {
        orgId,
        targetUid,
        membershipStatus,
      });
    }
    throw httpsError('failed-precondition', 'El usuario objetivo no tiene membresía activa en esa organización.');
  }

  const userRef = db.collection('users').doc(targetUid);
  const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
  void memberRef;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const normalizedEmail = String(email ?? '').trim();

  const userSnap = await userRef.get();
  const currentEmail = String(userSnap.data()?.email ?? '').trim();

  if (normalizedEmail && normalizedEmail !== currentEmail) {
    try {
      await admin.auth().updateUser(targetUid, { email: normalizedEmail });
    } catch (err: any) {
      const code = String(err?.code ?? '');
      if (code === 'auth/email-already-exists') {
        throw httpsError('failed-precondition', 'El correo electrónico ya está en uso.');
      }
      if (code === 'auth/invalid-email') {
        throw httpsError('invalid-argument', 'El correo electrónico no es válido.');
      }
      if (code === 'auth/user-not-found') {
        throw httpsError('not-found', 'No se encontró el usuario en Auth.');
      }
      console.error('updateOrganizationUserProfile auth update failed', { targetUid, orgId, code, err });
      throw httpsError('internal', 'No se pudo actualizar el correo electrónico en Auth.');
    }
  }

  const normalizedLocationId = locationId || null;

  const userPayload = {
    displayName: displayName || null,
    email: normalizedEmail || null,
    departmentId: departmentId || null,
    locationId: normalizedLocationId,
    updatedAt: now,
    source: 'orgUpdateUserProfile_v1',
  };

  const memberPayload = {
    displayName: displayName || null,
    email: normalizedEmail || null,
    departmentId: departmentId || null,
    locationId: normalizedLocationId,
    updatedAt: now,
    source: 'orgUpdateUserProfile_v1',
  };

  const batch = db.batch();
  batch.set(userRef, userPayload, { merge: true });
  batch.set(memberRef, memberPayload, { merge: true });
  await batch.commit();

  await auditLog({
    action: 'orgUpdateUserProfile',
    actorUid,
    actorEmail,
    orgId,
    targetUid,
    targetEmail: normalizedEmail || null,
    after: {
      displayName: displayName || null,
      email: normalizedEmail || null,
      departmentId: departmentId || null,
      locationId: normalizedLocationId,
    },
  });
}

async function updateOrganizationAppleEntitlement({
  orgId,
  planId,
  status,
  currentPeriodEnd,
}: {
  orgId: string;
  planId?: EntitlementPlanId;
  status: EntitlementStatus;
  currentPeriodEnd?: admin.firestore.Timestamp | null;
}) {
  const orgRef = db.collection('organizations').doc(orgId);
  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) {
      throw new Error(`Organization ${orgId} not found.`);
    }

    const orgData = orgSnap.data() as { entitlement?: Entitlement } | undefined;
    const entitlement = orgData?.entitlement;
    const usage = entitlement?.usage ?? DEFAULT_ENTITLEMENT_USAGE;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const resolvedPlanId = resolveEntitlementPlanId({
      metadataPlanId: planId ?? null,
      fallbackPlanId: entitlement?.planId,
    });
    const limits = resolveEffectiveLimitsForPlan(
      resolvedPlanId,
      hasPlanChanged(entitlement?.planId, resolvedPlanId) ? null : entitlement?.limits
    );

    const shouldBlock = shouldBlockProviderUpdate(entitlement, 'apple_app_store');
    const billingProviderPayload: Record<string, unknown> = shouldBlock
      ? buildConflictPayload({
          planId: resolvedPlanId,
          status,
          now,
          reason: `active_provider_${entitlement?.provider ?? 'unknown'}`,
        })
      : {
          planId: resolvedPlanId,
          status,
          updatedAt: now,
        };

    if (currentPeriodEnd) {
      billingProviderPayload.currentPeriodEnd = currentPeriodEnd;
    }

    const updatePayload: Record<string, unknown> = {
      billingProviders: {
        apple_app_store: billingProviderPayload,
      },
      updatedAt: now,
    };

    if (!shouldBlock) {
      updatePayload.entitlement = buildEntitlementPayload({
        planId: resolvedPlanId,
        status,
        currentPeriodEnd,
        provider: 'apple_app_store',
        now,
        limits,
        usage,
      });
    }

    tx.set(orgRef, updatePayload, { merge: true });
  });
}

function sendHttpError(res: Response, err: any) {
  const code = String(err?.code ?? 'internal');
  const message = String(err?.message ?? 'Error inesperado.');
  const status = (() => {
    switch (code) {
      case 'invalid-argument':
        return 400;
      case 'unauthenticated':
        return 401;
      case 'permission-denied':
        return 403;
      case 'not-found':
        return 404;
      case 'failed-precondition':
        return 400;
      default:
        return 500;
    }
  })();

  res.status(status).json({ error: message, code });
}

function requireAuth(context: functions.https.CallableContext) {
  if (!context.auth?.uid) throw httpsError('unauthenticated', 'Debes iniciar sesión.');
  return context.auth.uid;
}

function normalizeAccountPlan(value: unknown): AccountPlan {
  const plan = String(value ?? '').trim().toLowerCase();
  if (plan === 'personal_plus' || plan === 'business_creator' || plan === 'enterprise') {
    return plan as AccountPlan;
  }
  return DEFAULT_ACCOUNT_PLAN;
}

function resolveCreatedOrganizationsLimit(plan: AccountPlan, storedLimit: unknown): number {
  if (plan === 'enterprise') {
    const limit = Number(storedLimit);
    if (Number.isFinite(limit) && limit > 0) {
      return Math.floor(limit);
    }
  }
  return CREATED_ORG_LIMITS[plan] ?? CREATED_ORG_LIMITS[DEFAULT_ACCOUNT_PLAN];
}

function getUserOrgQuota(userData?: FirebaseFirestore.DocumentData | null) {
  const accountPlan = normalizeAccountPlan(userData?.accountPlan);
  const createdOrganizationsCountRaw = Number(userData?.createdOrganizationsCount ?? 0);
  let createdOrganizationsCount =
    Number.isFinite(createdOrganizationsCountRaw) && createdOrganizationsCountRaw >= 0
      ? Math.floor(createdOrganizationsCountRaw)
      : 0;
  const createdOrganizationsLimit = resolveCreatedOrganizationsLimit(
    accountPlan,
    userData?.createdOrganizationsLimit,
  );
  const demoUsedAt = userData?.demoUsedAt ?? null;
  const primaryOrgId = String(userData?.organizationId ?? '');

  if (demoUsedAt && primaryOrgId.startsWith('demo-') && createdOrganizationsCount > 0) {
    createdOrganizationsCount -= 1;
  }

  return {
    accountPlan,
    createdOrganizationsCount,
    createdOrganizationsLimit,
    demoUsedAt,
  };
}

async function seedDemoOrganizationData({
  organizationId,
  uid,
}: {
  organizationId: string;
  uid: string;
}) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const baseDate = new Date();
  const makeTimestamp = (offsetDays: number) => {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + offsetDays);
    return admin.firestore.Timestamp.fromDate(date);
  };

  const sites = [
    { id: `${organizationId}_site_1`, name: 'Planta principal', code: 'PL-01' },
    { id: `${organizationId}_site_2`, name: 'Almacén central', code: 'ALM-01' },
    { id: `${organizationId}_site_3`, name: 'Oficina técnica', code: 'OFI-01' },
  ];

  const departments = [
    { id: `${organizationId}_dept_1`, name: 'Mantenimiento', code: 'MTTO' },
    { id: `${organizationId}_dept_2`, name: 'Producción', code: 'PROD' },
    { id: `${organizationId}_dept_3`, name: 'Calidad', code: 'CAL' },
  ];

  const tasks = [
    {
      id: `${organizationId}_task_1`,
      title: 'Revisión mensual de calderas',
      description: 'Verificar presión, válvulas de seguridad y registros de mantenimiento.',
      status: 'open',
      priority: 'alta',
      dueDate: makeTimestamp(3),
      location: departments[0]?.id,
    },
    {
      id: `${organizationId}_task_2`,
      title: 'Inspección de línea de producción',
      description: 'Comprobar sensores y lubricación en la línea 2.',
      status: 'in_progress',
      priority: 'media',
      dueDate: makeTimestamp(7),
      location: departments[1]?.id,
    },
    {
      id: `${organizationId}_task_3`,
      title: 'Actualizar checklist de seguridad',
      description: 'Revisar procedimientos y registrar cambios en el plan de seguridad.',
      status: 'done',
      priority: 'baja',
      dueDate: makeTimestamp(-2),
      location: departments[2]?.id,
      closedAt: makeTimestamp(-1),
      closedBy: uid,
      closedReason: 'Checklist actualizado y validado.',
    },
  ];

  const year = new Date().getFullYear();
  const tickets = [
    {
      id: `${organizationId}_ticket_1`,
      displayId: `INC-${year}-1001`,
      type: 'correctivo',
      status: 'new',
      priority: 'Alta',
      siteId: sites[0]?.id,
      departmentId: departments[0]?.id,
      title: 'Fuga de agua en sala de bombas',
      description: 'Se detecta pérdida de agua en la bomba principal.',
    },
    {
      id: `${organizationId}_ticket_2`,
      displayId: `INC-${year}-1002`,
      type: 'correctivo',
      status: 'in_progress',
      priority: 'Media',
      siteId: sites[1]?.id,
      departmentId: departments[1]?.id,
      title: 'Vibración en motor de cinta',
      description: 'El motor presenta vibración excesiva durante el arranque.',
    },
    {
      id: `${organizationId}_ticket_3`,
      displayId: `INC-${year}-1003`,
      type: 'correctivo',
      status: 'resolved',
      priority: 'Baja',
      siteId: sites[2]?.id,
      departmentId: departments[2]?.id,
      title: 'Iluminación insuficiente en pasillo',
      description: 'Se sustituyeron luminarias y se verificó el nivel de lux.',
      closedAt: makeTimestamp(-1),
      closedBy: uid,
      closedReason: 'Luminarias reemplazadas.',
    },
  ];

  const batch = db.batch();
  const orgRef = db.collection('organizations').doc(organizationId);

  // Ensure org settings doc exists for client gating.
  batch.set(
    orgRef.collection('settings').doc('main'),
    {
      organizationId,
      ...DEFAULT_ORG_SETTINGS_MAIN,
      createdAt: now,
      updatedAt: now,
      source: 'demo_seed_v1',
    },
    { merge: true },
  );

  sites.forEach((site) => {
    const ref = orgRef.collection('sites').doc(site.id);
    batch.set(
      ref,
      {
        organizationId,
        name: site.name,
        code: site.code,
        createdAt: now,
        updatedAt: now,
        source: 'demo_seed_v1',
      },
      { merge: true },
    );
  });

  departments.forEach((department) => {
    const ref = orgRef.collection('departments').doc(department.id);
    batch.set(
      ref,
      {
        organizationId,
        name: department.name,
        code: department.code,
        createdAt: now,
        updatedAt: now,
        source: 'demo_seed_v1',
      },
      { merge: true },
    );
  });

  tasks.forEach((task) => {
    const ref = orgRef.collection('tasks').doc(task.id);
    batch.set(
      ref,
      {
        organizationId,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        location: task.location,
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
        closedAt: task.closedAt ?? null,
        closedBy: task.closedBy ?? null,
        closedReason: task.closedReason ?? null,
        source: 'demo_seed_v1',
      },
      { merge: true },
    );
  });

  tickets.forEach((ticket) => {
    const ref = orgRef.collection('tickets').doc(ticket.id);
    batch.set(
      ref,
      {
        organizationId,
        displayId: ticket.displayId,
        type: ticket.type,
        status: ticket.status,
        priority: ticket.priority,
        siteId: ticket.siteId,
        departmentId: ticket.departmentId,
        title: ticket.title,
        description: ticket.description,
        createdBy: uid,
        assignedRole: 'mantenimiento',
        assignedTo: null,
        createdAt: now,
        updatedAt: now,
        closedAt: ticket.closedAt ?? null,
        closedBy: ticket.closedBy ?? null,
        closedReason: ticket.closedReason ?? null,
        source: 'demo_seed_v1',
      },
      { merge: true },
    );
  });

  await batch.commit();
}

function isRootClaim(context: functions.https.CallableContext): boolean {
  return Boolean((context.auth?.token as any)?.root === true);
}

function normalizeRoleOrNull(input: any): Role | null {
  const r = String(input ?? '').trim().toLowerCase();
  if (!r) return null;

  if (r === 'super_admin') return 'super_admin';
  if (r === 'admin') return 'admin';
  if (r === 'mantenimiento') return 'mantenimiento';
  if (r === 'jefe_departamento') return 'jefe_departamento';
  if (r === 'jefe_ubicacion') return 'jefe_ubicacion';
  if (r === 'auditor') return 'auditor';
  if (r === 'operario') return 'operario';

  return null;
}

function normalizeRole(input: any): Role {
  return normalizeRoleOrNull(input) ?? 'operario';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => Boolean(item));
}

function normalizeStatus(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '_');
}

function isOpenStatus(status: unknown): boolean {
  const normalized = normalizeStatus(status);
  // Tickets/incidencias
  if (['new', 'open', 'in_progress', 'pending', 'assigned', 'reopened', 'waiting_parts', 'waiting_external'].includes(normalized)) {
    return true;
  }
  // Spanish variants seen in UI
  if (['abierta', 'en_curso', 'en_espera', 'cierre_solicitado'].includes(normalized)) {
    return true;
  }
  return false;
}

function resolveMembershipScope(userData: FirebaseFirestore.DocumentData | null): MembershipScope {
  const departmentId = String(userData?.departmentId ?? '').trim();
  const locationId = String(userData?.locationId ?? '').trim();
  return {
    departmentId: departmentId || undefined,
    departmentIds: normalizeStringArray(userData?.departmentIds),
    locationId: locationId || undefined,
    locationIds: normalizeStringArray(userData?.locationIds),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as unknown as T;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const cleaned = entries.reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
      const normalized = stripUndefinedDeep(nestedValue as unknown);
      if (normalized !== undefined) {
        acc[key] = normalized;
      }
      return acc;
    }, {});
    return cleaned as T;
  }

  return value;
}

function requireRoleAllowed(role: Role, allowed: Set<Role>, message: string) {
  if (!allowed.has(role)) {
    throw httpsError('permission-denied', message);
  }
}

function requireScopedAccessToDepartment(role: Role, scope: MembershipScope, departmentId: string) {
  if (!SCOPED_HEAD_ROLES.has(role)) return;
  const allowedDepartmentIds = new Set([scope.departmentId, ...scope.departmentIds].filter(Boolean));
  if (!departmentId) {
    throw httpsError('invalid-argument', 'departmentId requerido para validar alcance.');
  }
  if (allowedDepartmentIds.size === 0 || !allowedDepartmentIds.has(departmentId)) {
    throw httpsError('permission-denied', 'No tienes acceso a ese departamento.');
  }
}

function requireScopedAccessToSite(role: Role, scope: MembershipScope, siteId: string) {
  if (!SCOPED_HEAD_ROLES.has(role)) return;
  const allowedSiteIds = new Set([scope.locationId, ...scope.locationIds].filter(Boolean));
  if (!siteId) {
    throw httpsError('invalid-argument', 'siteId requerido para validar alcance.');
  }
  if (allowedSiteIds.size === 0 || !allowedSiteIds.has(siteId)) {
    throw httpsError('permission-denied', 'No tienes acceso a esa ubicación.');
  }
}

function requireStringField(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw httpsError('invalid-argument', `${field} requerido.`);
  return normalized;
}

async function requireActiveMembership(actorUid: string, orgId: string): Promise<ResolvedMembership> {
  const membershipRef = db.collection('memberships').doc(`${actorUid}_${orgId}`);
  const userRef = db.collection('users').doc(actorUid);

  const [membershipSnap, userSnap] = await Promise.all([membershipRef.get(), userRef.get()]);
  if (!membershipSnap.exists) {
    throw httpsError('permission-denied', 'No perteneces a esa organización.');
  }

  const membershipData = membershipSnap.data() as FirebaseFirestore.DocumentData | null;
  const status =
    String(membershipData?.status ?? '') ||
    (membershipData?.active === true ? 'active' : 'pending');

  if (status !== 'active') {
    throw httpsError('failed-precondition', 'Tu membresía no está activa.');
  }

  const role = normalizeRole(membershipData?.role);
  const userData = userSnap.exists ? (userSnap.data() as FirebaseFirestore.DocumentData) : null;

  return {
    role,
    status,
    scope: resolveMembershipScope(userData),
    membershipData,
    userData,
  };
}

async function requireActiveMembershipForTx(
  tx: FirebaseFirestore.Transaction,
  orgId: string,
  actorUid: string
): Promise<ResolvedMembership> {
  const membershipRef = db.collection('memberships').doc(`${actorUid}_${orgId}`);
  const userRef = db.collection('users').doc(actorUid);

  const [membershipSnap, userSnap] = await Promise.all([tx.get(membershipRef), tx.get(userRef)]);
  if (!membershipSnap.exists) {
    throw httpsError('permission-denied', 'No perteneces a esa organización.');
  }

  const membershipData = membershipSnap.data() as FirebaseFirestore.DocumentData | null;
  const status =
    String(membershipData?.status ?? '') ||
    (membershipData?.active === true ? 'active' : 'pending');

  if (status !== 'active') {
    throw httpsError('failed-precondition', 'Tu membresía no está activa.');
  }

  const role = normalizeRole(membershipData?.role);
  const userData = userSnap.exists ? (userSnap.data() as FirebaseFirestore.DocumentData) : null;

  return {
    role,
    status,
    scope: resolveMembershipScope(userData),
    membershipData,
    userData,
  };
}

async function resolvePlanFeaturesForTx(tx: FirebaseFirestore.Transaction, planId: string | undefined) {
  const resolvedPlanId = resolveEntitlementPlanId({ metadataPlanId: planId ?? null });
  const planSnap = await tx.get(db.collection('planCatalog').doc(resolvedPlanId));
  const rawFeatures = planSnap.exists
    ? (planSnap.get('features') as Record<string, boolean> | undefined)
    : undefined;
  return resolveEffectiveFeaturesForPlan(resolvedPlanId, rawFeatures ?? null);
}

async function resolvePlanLimitsForTx(
  tx: FirebaseFirestore.Transaction,
  planId: string | undefined,
  rawLimits?: Partial<EntitlementLimits> | null
): Promise<EntitlementLimits> {
  const resolvedPlanId = resolveEntitlementPlanId({ metadataPlanId: planId ?? null });
  const planSnap = await tx.get(db.collection('planCatalog').doc(resolvedPlanId));
  const planLimits = planSnap.exists
    ? (planSnap.get('limits') as Partial<EntitlementLimits> | undefined)
    : undefined;
  return resolveEffectiveLimitsForPlan(resolvedPlanId, planLimits ?? rawLimits ?? null);
}

async function resolveFallbackPreventivesEntitlementForTx(
  tx: FirebaseFirestore.Transaction,
  orgData: FirebaseFirestore.DocumentData | undefined,
  baseEntitlement: Entitlement,
): Promise<{ entitlement: Entitlement; features: Record<string, boolean> } | null> {
  const providersRaw = (orgData?.billingProviders ?? null) as
    | Partial<Record<EntitlementProvider, BillingProviderEntitlement>>
    | null;
  if (!providersRaw) return null;

  const activeProviders = Object.values(providersRaw)
    .filter((provider): provider is BillingProviderEntitlement => {
      if (!provider) return false;
      if (provider.conflict === true) return false;
      return provider.status === 'active' || provider.status === 'trialing';
    })
    .sort((a, b) => {
      const left = a.updatedAt instanceof admin.firestore.Timestamp ? a.updatedAt.toMillis() : 0;
      const right = b.updatedAt instanceof admin.firestore.Timestamp ? b.updatedAt.toMillis() : 0;
      return right - left;
    });

  for (const providerEntitlement of activeProviders) {
    const providerFeatures = await resolvePlanFeaturesForTx(tx, providerEntitlement.planId);
    const effectiveEntitlement: Entitlement = {
      ...baseEntitlement,
      planId: providerEntitlement.planId,
      status: providerEntitlement.status,
      trialEndsAt: providerEntitlement.trialEndsAt ?? baseEntitlement.trialEndsAt,
      currentPeriodEnd: providerEntitlement.currentPeriodEnd ?? baseEntitlement.currentPeriodEnd,
      updatedAt: providerEntitlement.updatedAt ?? baseEntitlement.updatedAt,
    };

    if (isFeatureEnabled({ ...(effectiveEntitlement as any), features: providerFeatures }, 'PREVENTIVES')) {
      return {
        entitlement: effectiveEntitlement,
        features: providerFeatures,
      };
    }
  }

  return null;
}

function resolveEffectiveEntitlementForTx(orgSnap: FirebaseFirestore.DocumentSnapshot): Entitlement {
  const orgData = orgSnap.data() as { entitlement?: Entitlement } | undefined;
  const entitlement = orgData?.entitlement;
  if (!entitlement) {
    throw httpsError('failed-precondition', 'La organización no tiene entitlement.');
  }

  const resolvedPlanId = resolveEntitlementPlanId({
    metadataPlanId: entitlement.planId ?? null,
    fallbackPlanId: entitlement.planId,
  });

  return {
    ...entitlement,
    planId: resolvedPlanId,
    limits: resolveEffectiveLimitsForPlan(resolvedPlanId, entitlement.limits),
    usage: entitlement.usage ?? DEFAULT_ENTITLEMENT_USAGE,
  };
}

function ensureEntitlementAllowsCreate({
  kind,
  entitlement,
  features,
  orgType,
}: {
  kind: keyof typeof USAGE_FIELDS;
  entitlement: {
    status?: string;
    planId?: EntitlementPlanId;
    limits?: EntitlementLimits;
    usage?: EntitlementUsage;
    trialEndsAt?: admin.firestore.Timestamp;
  };
  features?: Record<string, boolean>;
  orgType?: string;
}) {
  const status = String(entitlement?.status ?? '');
  if (status !== 'active' && status !== 'trialing') {
    throw httpsError('failed-precondition', 'Tu plan no está activo para crear nuevos elementos.');
  }

  if (entitlement?.trialEndsAt instanceof admin.firestore.Timestamp) {
    const now = admin.firestore.Timestamp.now();
    if (entitlement.trialEndsAt.toMillis() <= now.toMillis()) {
      throw httpsError('failed-precondition', 'Tu periodo de prueba expiró.');
    }
  }

  const isDemoOrg = orgType === 'demo';

  const normalizedPlanId = resolveEntitlementPlanId({
    metadataPlanId: entitlement?.planId ?? null,
  });

  if (kind === 'preventives' && !isDemoOrg && normalizedPlanId === 'free') {
    throw httpsError('failed-precondition', 'Tu plan no incluye preventivos.');
  }

  if (
    kind === 'preventives' &&
    !isDemoOrg &&
    !isFeatureEnabled({ ...(entitlement as any), features }, 'PREVENTIVES')
  ) {
    throw httpsError('failed-precondition', 'Tu plan no incluye preventivos.');
  }

  const effectiveLimits = resolveEffectiveLimitsForPlan(normalizedPlanId, entitlement?.limits);

  if (!canCreate(kind, entitlement?.usage, effectiveLimits)) {
    throw httpsError('failed-precondition', LIMIT_MESSAGES[kind]);
  }
}

function resolveOrgIdFromData(data: any): string {
  const orgId = sanitizeOrganizationId(String(data?.orgId ?? data?.organizationId ?? ''));
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  return orgId;
}

function isDemoOrganization(orgId: string, orgData: FirebaseFirestore.DocumentData | undefined) {
  const type = String(orgData?.type ?? '').trim();
  if (type === 'demo') return true;

  const subscriptionPlan = String(orgData?.subscriptionPlan ?? '').trim();
  if (subscriptionPlan === 'trial') return true;

  return orgId.startsWith('demo-');
}

async function ensureDemoTemplateLimit(
  tx: FirebaseFirestore.Transaction,
  orgRef: FirebaseFirestore.DocumentReference,
  isDemoOrg: boolean,
) {
  if (!isDemoOrg) return;

  const existingTemplatesSnap = await tx.get(
    orgRef.collection('preventiveTemplates').limit(DEMO_PREVENTIVE_TEMPLATES_LIMIT),
  );

  if (existingTemplatesSnap.size >= DEMO_PREVENTIVE_TEMPLATES_LIMIT) {
    throw httpsError(
      'failed-precondition',
      `La demo permite hasta ${DEMO_PREVENTIVE_TEMPLATES_LIMIT} plantillas preventivas.`,
    );
  }
}

async function pausePreventiveTicketsForOrg(orgId: string, now: admin.firestore.Timestamp) {
  const ticketsRef = db.collection('organizations').doc(orgId).collection('tickets');
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query = ticketsRef
      .where('type', '==', 'preventivo')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(200);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const ticketsSnap = await query.get();
    if (ticketsSnap.empty) break;

    const batch = db.batch();
    let updates = 0;

    ticketsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as any;
      if (data?.preventivePausedByEntitlement === true) return;
      const status = String(data?.status ?? '');
      if (status === 'resolved' || status === 'Resuelta' || status === 'Cerrada') return;

      batch.update(docSnap.ref, {
        status: 'in_progress',
        preventivePausedByEntitlement: true,
        preventivePausedAt: now,
        updatedAt: now,
      });
      updates += 1;
    });

    if (updates > 0) {
      await batch.commit();
    }

    lastDoc = ticketsSnap.docs[ticketsSnap.docs.length - 1] ?? null;
    if (ticketsSnap.size < 200) break;
  }

  await db.collection('organizations').doc(orgId).set(
    {
      preventivesPausedAt: now,
      preventivesPausedByEntitlement: true,
      updatedAt: now,
    },
    { merge: true },
  );
}

async function ensureDefaultOrganizationExists() {
  const ref = db.collection('organizations').doc('default');
  const snap = await ref.get();
  if (!snap.exists) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(
      {
        organizationId: 'default',
        name: 'default',
        isActive: true,
        entitlement: buildEntitlementPayload({
          planId: 'free',
          status: 'active',
          now,
        }),
        createdAt: now,
        updatedAt: now,
        source: 'ensure_default_org_v1',
      },
      { merge: true }
    );
  } else {
    const d = snap.data() as any;
    // si no existe el campo, lo normalizamos para que nunca se "pierda" en queries futuras
    if (d?.isActive === undefined || !d?.entitlement) {
      const now = admin.firestore.FieldValue.serverTimestamp();
      await ref.set(
        {
          ...(d?.isActive === undefined ? { isActive: true } : {}),
          ...(!d?.entitlement
            ? {
                entitlement: buildEntitlementPayload({
                  planId: 'free',
                  status: 'active',
                  now,
                }),
              }
            : {}),
          updatedAt: now,
        },
        { merge: true }
      );
    }
  }
}

async function countQuery(q: FirebaseFirestore.Query) {
  try {
    // @ts-ignore - count() existe en SDK modernos
    const agg = await q.count().get();
    // @ts-ignore
    return Number(agg.data()?.count ?? 0);
  } catch {
    const snap = await q.get();
    return snap.size;
  }
}

async function auditLog(params: {
  action: string;
  actorUid: string | null;
  actorEmail?: string | null;
  orgId?: string | null;
  targetUid?: string | null;
  targetEmail?: string | null;
  before?: any;
  after?: any;
  meta?: any;
}) {
  const collectionRef = params.orgId
    ? db.collection('organizations').doc(params.orgId).collection('auditLogs')
    : db.collection('auditLogs');
  await collectionRef.add({
    ...params,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/* ------------------------------
   FIRESTORE TRIGGERS (GEN1)
--------------------------------- */

export const onTicketAssign = functions.firestore
  .document('organizations/{orgId}/tickets/{ticketId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;

    const beforeAssignedTo = before.assignedTo ?? null;
    const afterAssignedTo = after.assignedTo ?? null;
    if (!afterAssignedTo || beforeAssignedTo === afterAssignedTo) return;

    try {
      const orgId = after.organizationId ?? context.params.orgId ?? null;
      const baseUrl = 'https://multi.maintelligence.app';
      const link = orgId
        ? `${baseUrl}/incidents/${context.params.ticketId}?org=${encodeURIComponent(String(orgId))}`
        : `${baseUrl}/incidents/${context.params.ticketId}`;
      await sendAssignmentEmail({
        organizationId: orgId,
        assignedTo: after.assignedTo ?? null,
        departmentId: after.departmentId ?? null,
        title: after.title ?? '(sin título)',
        link,
        type: 'incidencia',
        identifier: after.displayId ?? context.params.ticketId,
        description: after.description ?? '',
        priority: after.priority ?? '',
        status: after.status ?? '',
        location: after.departmentId ?? null,
      });
    } catch (error) {
      console.error('[onTicketAssign] Error enviando email de asignación', error);
    }
  });

export const onTaskAssign = functions.firestore
  .document('organizations/{orgId}/tasks/{taskId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;

    const beforeAssignedTo = before.assignedTo ?? null;
    const afterAssignedTo = after.assignedTo ?? null;
    if (!afterAssignedTo || beforeAssignedTo === afterAssignedTo) return;

    try {
      const orgId = after.organizationId ?? context.params.orgId ?? null;
      const baseUrl = 'https://multi.maintelligence.app';
      const link = orgId
        ? `${baseUrl}/tasks/${context.params.taskId}?org=${encodeURIComponent(String(orgId))}`
        : `${baseUrl}/tasks/${context.params.taskId}`;
      await sendAssignmentEmail({
        organizationId: orgId,
        assignedTo: after.assignedTo ?? null,
        departmentId: after.location ?? null,
        title: after.title ?? '(sin título)',
        link,
        type: 'tarea',
        identifier: context.params.taskId,
        description: after.description ?? '',
        priority: after.priority ?? '',
        status: after.status ?? '',
        dueDate: after.dueDate ?? null,
        location: after.location ?? null,
        category: after.category ?? null,
      });
    } catch (error) {
      console.error('[onTaskAssign] Error enviando email de asignación', error);
    }
  });

export const onTicketCreate = functions.firestore
  .document('organizations/{orgId}/tickets/{ticketId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() as any;
    if (!data?.assignedTo) return;

    try {
      const orgId = data.organizationId ?? context.params.orgId ?? null;
      const baseUrl = 'https://multi.maintelligence.app';
      const link = orgId
        ? `${baseUrl}/incidents/${context.params.ticketId}?org=${encodeURIComponent(String(orgId))}`
        : `${baseUrl}/incidents/${context.params.ticketId}`;
      await sendAssignmentEmail({
        organizationId: orgId,
        assignedTo: data.assignedTo ?? null,
        departmentId: data.departmentId ?? null,
        title: data.title ?? '(sin título)',
        link,
        type: 'incidencia',
        identifier: data.displayId ?? context.params.ticketId,
        description: data.description ?? '',
        priority: data.priority ?? '',
        status: data.status ?? '',
        location: data.departmentId ?? null,
      });
    } catch (error) {
      console.error('[onTicketCreate] Error enviando email de asignación', error);
    }
  });

export const onTaskCreate = functions.firestore
  .document('organizations/{orgId}/tasks/{taskId}')
  .onCreate(async (snap, context) => {
    const data = snap.data() as any;
    if (!data?.assignedTo) return;

    try {
      const orgId = data.organizationId ?? context.params.orgId ?? null;
      const baseUrl = 'https://multi.maintelligence.app';
      const link = orgId
        ? `${baseUrl}/tasks/${context.params.taskId}?org=${encodeURIComponent(String(orgId))}`
        : `${baseUrl}/tasks/${context.params.taskId}`;
      await sendAssignmentEmail({
        organizationId: orgId,
        assignedTo: data.assignedTo ?? null,
        departmentId: data.location ?? null,
        title: data.title ?? '(sin título)',
        link,
        type: 'tarea',
        identifier: context.params.taskId,
        description: data.description ?? '',
        priority: data.priority ?? '',
        status: data.status ?? '',
        dueDate: data.dueDate ?? null,
        location: data.location ?? null,
        category: data.category ?? null,
      });
    } catch (error) {
      console.error('[onTaskCreate] Error enviando email de asignación', error);
    }
  });

export const onTicketClosed = functions.firestore
  .document('organizations/{orgId}/tickets/{ticketId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!before || !after) return;

    if (before.status === after.status) return;

    const s = String(after.status ?? '').toLowerCase();
    if (s !== 'cerrada' && s !== 'closed') return;

    console.log('[onTicketClosed]', context.params.ticketId, 'status ->', after.status);
  });

export const onTicketDeleted = functions.firestore
  .document('organizations/{orgId}/tickets/{ticketId}')
  .onDelete(async (_snap, context) => {
    console.log('[onTicketDeleted]', context.params.ticketId);
  });

export const onTaskDeleted = functions.firestore
  .document('organizations/{orgId}/tasks/{taskId}')
  .onDelete(async (_snap, context) => {
    console.log('[onTaskDeleted]', context.params.taskId);
  });

/* ------------------------------
   ROOT (custom claim) CALLABLES
--------------------------------- */

function requireRoot(context: functions.https.CallableContext) {
  const uid = requireAuth(context);
  if (!isRootClaim(context)) throw httpsError('permission-denied', 'Solo ROOT (claim) puede hacer esto.');
  return uid;
}

export const rootListOrganizations = functions.https.onCall(async (data, context) => {
  requireRoot(context);

  const limit = Math.min(Number(data?.limit ?? 25), 200);
  const cursor = String(data?.cursor ?? '').trim(); // last docId
  const qTerm = String(data?.q ?? '').trim();
  const includeDefault = data?.includeDefault !== false; // default true
  const includeInactive = data?.includeInactive !== false; // default true

  if (includeDefault) await ensureDefaultOrganizationExists();

  // OJO: NO usar where('isActive','!=',false) porque excluye docs sin el campo isActive (como default)
  let query: FirebaseFirestore.Query = db
    .collection('organizations')
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(limit + 1);

  if (qTerm) {
    query = db
      .collection('organizations')
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAt(qTerm)
      .endAt(qTerm + '\uf8ff')
      .limit(limit + 1);
  } else if (cursor) {
    query = db
      .collection('organizations')
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAfter(cursor)
      .limit(limit + 1);
  }

  const snap = await query.get();
  const docs = snap.docs;

  const hasMore = docs.length > limit;
  const sliced = hasMore ? docs.slice(0, limit) : docs;

  let rows = sliced.map((d) => {
    const v = d.data() as any;
    const isActive = v?.isActive !== false; // missing => true
    return {
      id: d.id,
      name: v?.name ?? null,
      isActive,
      createdAt: v?.createdAt ?? null,
      updatedAt: v?.updatedAt ?? null,
    };
  });

  if (!includeInactive) rows = rows.filter((o) => o.isActive);

  // fuerza default visible si por lo que sea no vino (y el caller lo pidió)
  if (includeDefault && !rows.some((r) => r.id === 'default')) {
    const def = await db.collection('organizations').doc('default').get();
    if (def.exists) {
      const v = def.data() as any;
      rows.unshift({
        id: 'default',
        name: v?.name ?? 'default',
        isActive: v?.isActive !== false,
        createdAt: v?.createdAt ?? null,
        updatedAt: v?.updatedAt ?? null,
      });
    }
  }

  const nextCursor = hasMore ? docs[limit].id : null;

  return { ok: true, organizations: rows, nextCursor };
});

export const rootOrgSummary = functions.https.onCall(async (data, context) => {
  requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const membersQ = db.collection('organizations').doc(orgId).collection('members');
  const usersQ = db.collection('organizations').doc(orgId).collection('members');

  const ticketsQ = db.collection('organizations').doc(orgId).collection('tickets');
  const tasksQ = db.collection('organizations').doc(orgId).collection('tasks');
  const sitesQ = db.collection('organizations').doc(orgId).collection('sites');
  const assetsQ = db.collection('organizations').doc(orgId).collection('assets');
  const depsQ = db.collection('organizations').doc(orgId).collection('departments');

  const [members, users, tickets, tasks, sites, assets, departments] = await Promise.all([
    countQuery(membersQ),
    countQuery(usersQ),
    countQuery(ticketsQ),
    countQuery(tasksQ),
    countQuery(sitesQ),
    countQuery(assetsQ),
    countQuery(depsQ),
  ]);

  return {
    ok: true,
    organizationId: orgId,
    summary: { members, users, tickets, tasks, sites, assets, departments },
  };
});

export const rootListUsersByOrg = functions.https.onCall(async (data, context) => {
  requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const limit = Math.min(Number(data?.limit ?? 25), 200);
  const cursorEmail = String(data?.cursorEmail ?? '').trim();
  const cursorUid = String(data?.cursorUid ?? '').trim();
  const qTerm = String(data?.q ?? '').trim();

  let query: FirebaseFirestore.Query = db
    .collection('organizations')
    .doc(orgId)
    .collection('members')
    .orderBy('email')
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(limit + 1);

  if (qTerm) {
    query = db
      .collection('organizations')
      .doc(orgId)
      .collection('members')
      .orderBy('email')
      .startAt(qTerm)
      .endAt(qTerm + '\uf8ff')
      .limit(limit + 1);
  } else if (cursorEmail && cursorUid) {
    query = db
      .collection('organizations')
      .doc(orgId)
      .collection('members')
      .orderBy('email')
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAfter(cursorEmail, cursorUid)
      .limit(limit + 1);
  }

  const snap = await query.get();
  const docs = snap.docs;
  const hasMore = docs.length > limit;
  const sliced = hasMore ? docs.slice(0, limit) : docs;

  const users = sliced.map((d) => {
    const v = d.data() as any;
    return {
      uid: d.id,
      email: v?.email ?? null,
      displayName: v?.displayName ?? null,
      active: v?.active !== false,
      role: v?.role ?? null,
      departmentId: v?.departmentId ?? null,
      createdAt: v?.createdAt ?? null,
      updatedAt: v?.updatedAt ?? null,
    };
  });

  const nextCursor = hasMore ? docs[limit] : null;

  return {
    ok: true,
    organizationId: orgId,
    users,
    nextCursorEmail: nextCursor ? String(nextCursor.get('email') ?? '') : null,
    nextCursorUid: nextCursor ? nextCursor.id : null,
  };
});

export const rootUpsertUserToOrganization = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const email = String(data?.email ?? '').trim().toLowerCase();
  const orgId = String(data?.organizationId ?? '').trim();
  const roleIn = String(data?.role ?? '').trim();

  if (!email) throw httpsError('invalid-argument', 'Email requerido.');
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const role: Role = normalizeRole(roleIn);

  const authUser = await admin.auth().getUserByEmail(email).catch(() => null);
  if (!authUser?.uid) throw httpsError('not-found', 'No existe ese usuario en Auth.');

  const uid = authUser.uid;
  const orgRef = db.collection('organizations').doc(orgId);
  const orgSnap = await orgRef.get();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const entitlementPayload =
    !orgSnap.exists || !orgSnap.get('entitlement')
      ? buildEntitlementPayload({
          planId: 'free',
          status: 'active',
          now,
        })
      : null;

  await orgRef.set(
    {
      organizationId: orgId,
      name: orgId,
      isActive: true,
      updatedAt: now,
      ...(entitlementPayload ? { entitlement: entitlementPayload } : {}),
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  const userRef = db.collection('users').doc(uid);
  const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(uid);
  void memberRef;
  const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);

  const beforeSnap = await userRef.get();
  const before = beforeSnap.exists ? beforeSnap.data() : null;

  const batch = db.batch();

  batch.set(
    userRef,
    {
      email: authUser.email ?? email,
      displayName: authUser.displayName ?? null,
      organizationId: orgId,
      role,
      active: true,
      updatedAt: now,
      createdAt: beforeSnap.exists ? beforeSnap.get('createdAt') ?? now : now,
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  batch.set(
    memberRef,
    {
      uid,
      orgId,
      email: authUser.email ?? email,
      displayName: authUser.displayName ?? null,
      active: true,
      role,
      updatedAt: now,
      createdAt: now,
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  batch.set(
    membershipRef,
    {
      userId: uid,
      organizationId: orgId,
      role,
      active: true,
      updatedAt: now,
      createdAt: now,
      source: 'root_upsert_user_v1',
    },
    { merge: true }
  );

  await batch.commit();

  await auditLog({
    action: 'rootUpsertUserToOrganization',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
    targetUid: uid,
    targetEmail: email,
    before,
    after: { organizationId: orgId, role },
  });

  return { ok: true, uid, email, organizationId: orgId, role };
});

export const rootDeactivateOrganization = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  const isActive = Boolean(data?.isActive ?? false);
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const status = isActive ? 'active' : 'suspended';
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(
    db.collection('organizations').doc(orgId),
    {
      isActive,
      status,
      updatedAt: now,
      source: 'rootDeactivateOrganization_v1',
    },
    { merge: true }
  );
  batch.set(
    db.collection('organizationsPublic').doc(orgId),
    {
      isActive,
      status,
      updatedAt: now,
      source: 'rootDeactivateOrganization_v1',
    },
    { merge: true }
  );

  await batch.commit();

  await auditLog({
    action: 'rootDeactivateOrganization',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
    after: { isActive, status },
  });

  return { ok: true, organizationId: orgId, isActive, status };
});

export const rootSetOrganizationPlan = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const reason = String(data?.reason ?? '').trim();
  if (!reason) throw httpsError('invalid-argument', 'reason requerido.');

  const requestedPlanIdRaw = String(data?.planId ?? '').trim();
  const requestedEntitlementStatusRaw = String(data?.entitlementStatus ?? data?.status ?? '').trim();
  const requestedOrgStatusRaw = String(data?.organizationStatus ?? '').trim();
  const providerRaw = String(data?.provider ?? '').trim().toLowerCase();
  const provider: EntitlementProvider = providerRaw === 'manual' ? 'manual' : DEFAULT_ENTITLEMENT_PROVIDER;

  const applyPlan = Boolean(requestedPlanIdRaw) || Boolean(requestedEntitlementStatusRaw);
  const applyOrgStatus = Boolean(requestedOrgStatusRaw);

  if (!applyPlan && !applyOrgStatus) {
    throw httpsError('invalid-argument', 'Debes enviar plan/status de entitlement y/o organizationStatus.');
  }

  const orgStatus = applyOrgStatus ? resolveOrganizationStatus(requestedOrgStatusRaw) : null;
  if (applyOrgStatus && !orgStatus) {
    throw httpsError('invalid-argument', 'organizationStatus inválido.');
  }

  const orgRef = db.collection('organizations').doc(orgId);
  const orgPublicRef = db.collection('organizationsPublic').doc(orgId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  let auditBefore: Record<string, unknown> | null = null;
  let auditAfter: Record<string, unknown> | null = null;
  let planCatalogFound: boolean | null = null;

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'La organización no existe.');

    const orgData = orgSnap.data() as FirebaseFirestore.DocumentData;
    const currentEntitlement = orgData?.entitlement as Entitlement | undefined;

    const resolvedPlanId = resolveEntitlementPlanId({
      metadataPlanId: requestedPlanIdRaw || null,
      fallbackPlanId: currentEntitlement?.planId,
    });

    if (requestedPlanIdRaw) {
      const planSnap = await tx.get(db.collection('planCatalog').doc(resolvedPlanId));
      planCatalogFound = planSnap.exists;
      if (!planSnap.exists) {
        console.warn('rootSetOrganizationPlan: plan missing in planCatalog, applying manual override', {
          orgId,
          planId: resolvedPlanId,
          actorUid,
        });
      }
    }

    const resolvedEntitlementStatus = requestedEntitlementStatusRaw
      ? resolveEntitlementStatus(requestedEntitlementStatusRaw)
      : currentEntitlement?.status ?? 'active';

    if (!resolvedEntitlementStatus) {
      throw httpsError('invalid-argument', 'entitlementStatus inválido.');
    }

    const limits = resolveEffectiveLimitsForPlan(
      resolvedPlanId,
      hasPlanChanged(currentEntitlement?.planId, resolvedPlanId) ? null : currentEntitlement?.limits
    );
    const usage = currentEntitlement?.usage ?? DEFAULT_ENTITLEMENT_USAGE;

    const nextEntitlement = buildEntitlementPayload({
      planId: resolvedPlanId,
      status: resolvedEntitlementStatus,
      provider,
      now,
      limits,
      usage,
    });

    const updatePayload: Record<string, unknown> = {
      updatedAt: now,
      source: 'rootSetOrganizationPlan_v1',
    };

    const publicUpdatePayload: Record<string, unknown> = {
      updatedAt: now,
      source: 'rootSetOrganizationPlan_v1',
    };

    if (applyPlan) {
      updatePayload.entitlement = nextEntitlement;
      updatePayload.billingProviders = {
        ...(isPlainObject(orgData?.billingProviders) ? orgData.billingProviders : {}),
        manual: {
          planId: resolvedPlanId,
          status: resolvedEntitlementStatus,
          updatedAt: now,
          conflict: false,
          conflictReason: null,
          reason,
        },
      };
    }

    if (orgStatus) {
      const isActive = orgStatus === 'active';
      updatePayload.status = orgStatus;
      updatePayload.isActive = isActive;
      publicUpdatePayload.status = orgStatus;
      publicUpdatePayload.isActive = isActive;
    }

    tx.set(orgRef, updatePayload, { merge: true });
    if (orgStatus) {
      tx.set(orgPublicRef, publicUpdatePayload, { merge: true });
    }

    auditBefore = {
      organizationStatus: orgData?.status ?? null,
      isActive: orgData?.isActive ?? null,
      entitlement: currentEntitlement ?? null,
    };
    auditAfter = {
      organizationStatus: orgStatus ?? orgData?.status ?? null,
      isActive: orgStatus ? orgStatus === 'active' : orgData?.isActive ?? null,
      entitlement: applyPlan
        ? {
            planId: resolvedPlanId,
            status: resolvedEntitlementStatus,
            provider,
          }
        : currentEntitlement ?? null,
    };
  });

  await auditLog({
    action: 'rootSetOrganizationPlan',
    actorUid,
    actorEmail,
    orgId,
    before: auditBefore,
    after: auditAfter,
    meta: {
      reason,
      source: 'rootSetOrganizationPlan_v1',
      applyPlan,
      applyOrgStatus,
      planCatalogFound,
    },
  });

  return {
    ok: true,
    organizationId: orgId,
    updated: {
      plan: applyPlan,
      organizationStatus: applyOrgStatus,
    },
  };
});

export const orgSetOrganizationStatus = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);

  const orgId = String(data?.organizationId ?? '').trim();
  const status = String(data?.status ?? '').trim().toLowerCase();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!status || !['active', 'suspended', 'deleted'].includes(status)) {
    throw httpsError('invalid-argument', 'status inválido.');
  }

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  const isActive = status === 'active';
  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(
    db.collection('organizations').doc(orgId),
    {
      isActive,
      status,
      updatedAt: now,
      source: 'orgSetOrganizationStatus_v1',
    },
    { merge: true },
  );
  batch.set(
    db.collection('organizationsPublic').doc(orgId),
    {
      isActive,
      status,
      updatedAt: now,
      source: 'orgSetOrganizationStatus_v1',
    },
    { merge: true },
  );

  await batch.commit();

  await auditLog({
    action: 'orgSetOrganizationStatus',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
    after: { isActive, status },
  });

  return { ok: true, organizationId: orgId, isActive, status };
});

export const rootDeleteOrganizationScaffold = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const batch = db.batch();
  batch.delete(db.collection('organizations').doc(orgId));
  batch.delete(db.collection('organizationsPublic').doc(orgId));
  await batch.commit();

  await auditLog({
    action: 'rootDeleteOrganizationScaffold',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
  });

  return { ok: true, organizationId: orgId };
});

export const rootPurgeOrganizationCollection = functions.https.onCall(async (data, context) => {
  const actorUid = requireRoot(context);

  const orgId = String(data?.organizationId ?? '').trim();
  const collection = String(data?.collection ?? '').trim();
  const batchSize = Math.min(Math.max(Number(data?.batchSize ?? 200), 50), 500);

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!collection) throw httpsError('invalid-argument', 'collection requerida.');

  const allowed = new Set(['tickets', 'tasks', 'sites', 'assets', 'departments', 'members', 'joinRequests']);
  if (!allowed.has(collection)) throw httpsError('invalid-argument', 'Colección no permitida para purge.');

  let totalDeleted = 0;

  while (true) {
    const q = db.collection('organizations').doc(orgId).collection(collection).limit(batchSize);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    totalDeleted += snap.size;
    if (snap.size < batchSize) break;
  }

  await auditLog({
    action: 'rootPurgeOrganizationCollection',
    actorUid,
    actorEmail: (context.auth?.token as any)?.email ?? null,
    orgId,
    meta: { collection, totalDeleted, batchSize },
  });

  return { ok: true, organizationId: orgId, collection, deleted: totalDeleted };
});

/* ------------------------------
   ORG-SCOPED ROLE MGMT (callable)
   (para que el cliente NO toque roles)
--------------------------------- */

async function requireCallerSuperAdminInOrg(actorUid: string, orgId: string) {
  const mRef = db.collection('memberships').doc(`${actorUid}_${orgId}`);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw httpsError('permission-denied', 'No perteneces a esa organización.');

  // Backward-compat: some older docs used `active: true` instead of `status: 'active'`.
  const status =
    String(mSnap.get('status') ?? '') ||
    (mSnap.get('active') === true ? 'active' : 'pending');

  const role = normalizeRole(mSnap.get('role'));
  if (status !== 'active') throw httpsError('permission-denied', 'Tu membresía no está activa.');
  if (role !== 'super_admin') throw httpsError('permission-denied', 'Solo super_admin puede gestionar usuarios.');
}

async function resolveTargetUidByEmailOrUid(email?: string, uid?: string) {
  const u = String(uid ?? '').trim();
  if (u) return u;

  const e = String(email ?? '').trim().toLowerCase();
  if (!e) throw httpsError('invalid-argument', 'Debes indicar uid o email del usuario objetivo.');

  const authUser = await admin.auth().getUserByEmail(e).catch(() => null);
  if (!authUser?.uid) throw httpsError('not-found', 'No existe ese usuario en Auth.');
  return authUser.uid;
}

async function setRoleWithinOrgImpl(params: {
  actorUid: string;
  actorEmail: string | null;
  isRoot: boolean;
  orgId: string;
  targetUid: string;
  role: Role;
}) {
  const { actorUid, actorEmail, isRoot, orgId, targetUid, role } = params;

  if (!isRoot) {
    await requireCallerSuperAdminInOrg(actorUid, orgId);
  }

  
// Target must have a membership in this org
const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
const membershipSnap = await membershipRef.get();
if (!membershipSnap.exists) {
  throw httpsError(
    'failed-precondition',
    'El usuario objetivo no tiene membresía en esa organización. Debe registrarse y solicitar acceso primero.',
  );
}

const beforeRole = String(membershipSnap.get('role') ?? 'operario');
const beforeStatus =
  String(membershipSnap.get('status') ?? '') ||
  (membershipSnap.get('active') === true ? 'active' : 'pending');

if (beforeStatus !== 'active') {
  throw httpsError('failed-precondition', 'La membresía del usuario objetivo no está activa.');
}

if (beforeRole === role) {
  return { ok: true, uid: targetUid, organizationId: orgId, role, noChange: true };
}

const memberRef = db.collection('organizations').doc(orgId).collection('members').doc(targetUid);
void memberRef;
const userRef = db.collection('users').doc(targetUid);
const userSnap = await userRef.get();
const userBefore = userSnap.exists ? (userSnap.data() as any) : null;

const batch = db.batch();

  batch.set(
    userRef,
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'setRoleWithinOrg_v1',
    },
    { merge: true }
  );

  batch.set(
    memberRef,
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'setRoleWithinOrg_v1',
    },
    { merge: true }
  );

  batch.set(
    membershipRef,
    {
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'setRoleWithinOrg_v1',
    },
    { merge: true }
  );

  await batch.commit();

  await auditLog({
    action: 'setRoleWithinOrg',
    actorUid,
    actorEmail,
    orgId,
    targetUid,
    targetEmail: String(userBefore?.email ?? null),
    before: { role: beforeRole },
    after: { role },
  });

  return { ok: true, uid: targetUid, organizationId: orgId, role };
}

/* ------------------------------
   ONBOARDING / JOIN REQUESTS
--------------------------------- */

function sanitizeOrganizationId(input: string): string {
  const raw = String(input ?? '').trim().toLowerCase();
  // allow a-z0-9, dash, underscore. Convert spaces to dashes, drop others.
  const spaced = raw.replace(/\s+/g, '-');
  const cleaned = spaced.replace(/[^a-z0-9_-]/g, '');
  return cleaned;
}

export const resolveOrganizationId = functions.https.onCall(async (data) => {
  const input = String(data?.input ?? '').trim();
  if (!input) throw httpsError('invalid-argument', 'input requerido.');

  const normalizedId = sanitizeOrganizationId(input);

  if (normalizedId) {
    const orgPublicRef = db.collection('organizationsPublic').doc(normalizedId);
    const orgSnap = await orgPublicRef.get();
    if (orgSnap.exists) {
      const orgData = orgSnap.data() as { name?: string };
      return {
        organizationId: normalizedId,
        name: orgData?.name ?? normalizedId,
        matchedBy: 'id',
        matches: [],
      };
    }
  }

  const nameLower = input.toLowerCase();
  const matches: { organizationId: string; name: string }[] = [];

  const byNameLower = await db
    .collection('organizationsPublic')
    .where('nameLower', '==', nameLower)
    .limit(5)
    .get();

  byNameLower.forEach((docSnap) => {
    const data = docSnap.data() as { name?: string };
    matches.push({ organizationId: docSnap.id, name: data?.name ?? docSnap.id });
  });

  if (matches.length === 0) {
    const byNameExact = await db
      .collection('organizationsPublic')
      .where('name', '==', input)
      .limit(5)
      .get();

    byNameExact.forEach((docSnap) => {
      const data = docSnap.data() as { name?: string };
      matches.push({ organizationId: docSnap.id, name: data?.name ?? docSnap.id });
    });
  }

  if (matches.length === 1) {
    return {
      organizationId: matches[0].organizationId,
      name: matches[0].name,
      matchedBy: 'name',
      matches: [],
    };
  }

  return {
    organizationId: null,
    name: null,
    matchedBy: null,
    matches,
  };
});

export const checkOrganizationAvailability = functions.https.onCall(async (data) => {
  const input = String(data?.organizationId ?? '').trim();
  if (!input) throw httpsError('invalid-argument', 'organizationId requerido.');

  const normalizedId = sanitizeOrganizationId(input);
  if (!normalizedId) throw httpsError('invalid-argument', 'organizationId inválido.');

  const orgPublicRef = db.collection('organizationsPublic').doc(normalizedId);
  const orgSnap = await orgPublicRef.get();

  if (!orgSnap.exists) {
    return {
      normalizedId,
      available: true,
      suggestions: [],
      existingName: null,
    };
  }

  const existingName = String((orgSnap.data() as { name?: string })?.name ?? normalizedId);
  const candidates = Array.from({ length: 5 }, (_, idx) =>
    idx === 0 ? normalizedId : `${normalizedId}-${idx + 1}`,
  );

  const taken = new Set<string>();
  const snap = await db
    .collection('organizationsPublic')
    .where(admin.firestore.FieldPath.documentId(), 'in', candidates)
    .get();

  snap.forEach((docSnap) => taken.add(docSnap.id));

  const suggestions = candidates.filter((candidate) => !taken.has(candidate));

  return {
    normalizedId,
    available: false,
    suggestions,
    existingName,
  };
});

export const bootstrapFromInvites = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);

  try {
    const authUser = await admin.auth().getUser(uid).catch(() => null);
    const email = (authUser?.email ?? '').trim().toLowerCase();
    if (!email) {
      throw httpsError('failed-precondition', 'Email requerido.');
    }

    const joinReqByEmail = db
      .collectionGroup('joinRequests')
      .where('email', '==', email)
      .where('status', '==', 'pending');
    const joinReqByUid = db
      .collectionGroup('joinRequests')
      .where('userId', '==', uid)
      .where('status', '==', 'pending');

    const [emailSnap, uidSnap] = await Promise.all([joinReqByEmail.get(), joinReqByUid.get()]);
    const joinReqDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    emailSnap.docs.forEach((docSnap) => joinReqDocs.set(docSnap.ref.path, docSnap));
    uidSnap.docs.forEach((docSnap) => joinReqDocs.set(docSnap.ref.path, docSnap));

    if (joinReqDocs.size === 0) {
      return { ok: true, created: 0, claimed: 0 };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    let created = 0;

    for (const docSnap of joinReqDocs.values()) {
      const data = docSnap.data() as any;
      const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
      if (!orgId) continue;

      const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);
      const membershipSnap = await membershipRef.get();
      if (membershipSnap.exists) continue;

      batch.set(
        membershipRef,
        {
          userId: uid,
          organizationId: orgId,
          organizationName: String(data?.organizationName ?? orgId),
          role: normalizeRole(data?.requestedRole) ?? 'operario',
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          source: 'bootstrapFromInvites_v1',
        },
        { merge: true },
      );

      batch.set(
        docSnap.ref,
        {
          userId: uid,
          updatedAt: now,
          source: 'bootstrapFromInvites_v1',
        },
        { merge: true },
      );

      created += 1;
    }

    if (created > 0) {
      await batch.commit();
    }

    return { ok: true, created, claimed: created };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    console.error('bootstrapFromInvites: unexpected error', {
      uid,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return { ok: false, created: 0, claimed: 0 };
  }
});

export const bootstrapSignup = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);

  const orgIdIn = String(data?.organizationId ?? '');
  const organizationId = sanitizeOrganizationId(orgIdIn);
  if (!organizationId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const requestedRoleRaw = data?.requestedRole;
  const requestedRole = requestedRoleRaw ? normalizeRoleOrNull(requestedRoleRaw) : 'operario';
  if (!requestedRole) throw httpsError('invalid-argument', 'requestedRole inválido.');

  const authUser = await admin.auth().getUser(uid).catch(() => null);
  const email = (authUser?.email ?? String(data?.email ?? '')).trim().toLowerCase();
  const displayName = (authUser?.displayName ?? String(data?.displayName ?? '').trim()) || null;
  const orgRef = db.collection('organizations').doc(organizationId);
  const orgPublicRef = db.collection('organizationsPublic').doc(organizationId);
  const userRef = db.collection('users').doc(uid);
  const memberRef = orgRef.collection('members').doc(uid);
  void memberRef;
  const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);

  const now = admin.firestore.FieldValue.serverTimestamp();

  let orgSnap = await orgRef.get();
  if (!orgSnap.exists) {
    const details = (data?.organizationDetails ?? {}) as any;

    const orgName = String(details?.name ?? '').trim() || organizationId;
    const orgLegalName = String(details?.legalName ?? '').trim() || null;
    const isDemoOrg = organizationId.startsWith('demo-');
    const organizationType = isDemoOrg ? 'demo' : 'standard';

    if (!authUser?.emailVerified) {
      await db.collection('organizationSignupRequests').doc(uid).set(
        {
          userId: uid,
          email: email || null,
          organizationId,
          organizationName: orgName,
          organizationLegalName: orgLegalName,
          organizationDetails: {
            name: orgName,
            legalName: orgLegalName,
            taxId: String(details?.taxId ?? '').trim() || null,
            country: String(details?.country ?? '').trim() || null,
            address: String(details?.address ?? '').trim() || null,
            billingEmail: String(details?.billingEmail ?? '').trim() || email || null,
            phone: String(details?.phone ?? '').trim() || null,
            teamSize: Number.isFinite(Number(details?.teamSize)) ? Number(details?.teamSize) : null,
          },
          status: 'verification_pending',
          createdAt: now,
          updatedAt: now,
          source: 'bootstrapSignup_v1',
        },
        { merge: true },
      );

      return { ok: true, mode: 'verification_required', organizationId };
    }

    const demoExpiresAt = isDemoOrg
      ? admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        )
      : null;

    const creationResult = await db.runTransaction(async (tx) => {
      const [userSnapTx, orgSnapTx] = await tx.getAll(userRef, orgRef);
      if (orgSnapTx.exists) {
        return { created: false };
      }

      const userData = userSnapTx.exists ? (userSnapTx.data() as any) : null;
      const { accountPlan, createdOrganizationsCount, createdOrganizationsLimit, demoUsedAt } =
        getUserOrgQuota(userData);

      if (!isDemoOrg && createdOrganizationsCount >= createdOrganizationsLimit) {
        throw httpsError(
          'failed-precondition',
          'Has alcanzado el límite de organizaciones permitidas.',
        );
      }

      if (isDemoOrg && demoUsedAt) {
        throw httpsError(
          'failed-precondition',
          'Ya utilizaste tu organización demo. No es posible crear otra.',
        );
      }

      const userCreatedAt = userSnapTx.exists
        ? userSnapTx.get('createdAt') ?? now
        : now;

      tx.create(orgRef, {
        organizationId,
        name: orgName,
        legalName: orgLegalName,
        taxId: String(details?.taxId ?? '').trim() || null,
        country: String(details?.country ?? '').trim() || null,
        address: String(details?.address ?? '').trim() || null,
        billingEmail: String(details?.billingEmail ?? '').trim() || email || null,
        contactPhone: String(details?.phone ?? '').trim() || null,
        teamSize: Number.isFinite(Number(details?.teamSize)) ? Number(details?.teamSize) : null,
        subscriptionPlan: 'trial',
        isActive: true,
        type: organizationType,
        status: 'active',
        entitlement: buildEntitlementPayload({
          planId: 'free',
          status: 'trialing',
          trialEndsAt: demoExpiresAt ?? undefined,
          now,
        }),
        settings: {
          allowGuestAccess: false,
          maxUsers: 50,
          inviteOnly: false,
        },
        demoExpiresAt,
        createdByUserId: uid,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
      });

      // Create/update the org settings document (basic rentable defaults).
      tx.set(
        orgRef.collection('settings').doc('main'),
        {
          organizationId,
          ...DEFAULT_ORG_SETTINGS_MAIN,
          createdAt: now,
          updatedAt: now,
          source: 'bootstrapSignup_v1',
        },
        { merge: true },
      );

      tx.create(orgPublicRef, {
        organizationId,
        name: orgName,
        nameLower: orgName.toLowerCase(),
        isActive: true,
        type: organizationType,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
      });

      tx.set(
        userRef,
        {
          organizationId,
          email: email || null,
          displayName: displayName || email || 'Usuario',
          role: 'super_admin',
          active: true,
          accountPlan,
          createdOrganizationsCount: createdOrganizationsCount + (isDemoOrg ? 0 : 1),
          createdOrganizationsLimit,
          demoUsedAt: isDemoOrg ? now : demoUsedAt ?? null,
          updatedAt: now,
          createdAt: userCreatedAt,
          source: 'bootstrapSignup_v1',
        },
        { merge: true },
      );

      tx.create(membershipRef, {
        userId: uid,
        organizationId,
        organizationName: orgName,
        role: 'super_admin',
        status: 'active',
        primary: true,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
      });

      tx.create(memberRef, {
        uid,
        orgId: organizationId,
        email: email || null,
        displayName: displayName || email || 'Usuario',
        role: 'super_admin',
        active: true,
        createdAt: now,
        updatedAt: now,
        source: 'bootstrapSignup_v1',
      });

      return { created: true, isDemoOrg };
    });

    if (creationResult.created) {
      await auditLog({
        action: 'bootstrapSignup_create_org',
        actorUid: uid,
        actorEmail: email || null,
        orgId: organizationId,
        after: { organizationId, role: 'super_admin', status: 'active' },
      });

      if (isDemoOrg) {
        await seedDemoOrganizationData({ organizationId, uid });
      }

      return { ok: true, mode: 'created', organizationId };
    }

    orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
      throw httpsError('internal', 'No se pudo crear la organización.');
    }
  }

  const orgData = orgSnap.data() as any;
  const orgName = String(orgData?.name ?? organizationId);
  const inviteOnly = Boolean(orgData?.settings?.inviteOnly === true);
  const existingMembershipSnap = await membershipRef.get();
  if (existingMembershipSnap.exists) {
    const membershipData = existingMembershipSnap.data() as any;
    const membershipStatus =
      String(membershipData?.status ?? '') ||
      (membershipData?.active === true ? 'active' : 'pending');
    return {
      ok: true,
      mode: membershipStatus === 'active' ? 'already_member' : 'pending',
      organizationId,
    };
  }

  const inviteByUidRef = orgRef.collection('joinRequests').doc(uid);
  const inviteByEmailRef = email ? orgRef.collection('joinRequests').doc(`invite_${email}`) : null;
  const [inviteByUidSnap, inviteByEmailSnap] = await Promise.all([
    inviteByUidRef.get(),
    inviteByEmailRef ? inviteByEmailRef.get() : Promise.resolve(null),
  ]);
  const existingInviteSnap =
    inviteByUidSnap.exists ? inviteByUidSnap : inviteByEmailSnap?.exists ? inviteByEmailSnap : null;

  if (inviteOnly && !existingInviteSnap) {
    throw httpsError('failed-precondition', 'Esta organización solo admite altas por invitación.');
  }

  const joinReqRef = existingInviteSnap?.ref ?? inviteByUidRef;

  const batch = db.batch();

  batch.set(
    userRef,
    {
      organizationId,
      email: email || null,
      displayName: displayName || email || 'Usuario',
      role: 'pending',
      active: false,
      updatedAt: now,
      createdAt: now,
      source: 'bootstrapSignup_v1',
    },
    { merge: true },
  );

  batch.set(
    membershipRef,
    {
      userId: uid,
      organizationId,
      organizationName: orgName,
      // El rol solicitado queda pendiente hasta aprobación.
      role: requestedRole,
      status: 'pending',
      primary: false,
      createdAt: now,
      updatedAt: now,
      source: 'bootstrapSignup_v1',
    },
    { merge: true },
  );

  const joinReqPayload: Record<string, unknown> = {
    userId: uid,
    organizationId,
    organizationName: orgName,
    email: email || null,
    displayName: displayName || email || 'Usuario',
    requestedRole,
    status: 'pending',
    updatedAt: now,
  };

  if (!existingInviteSnap) {
    joinReqPayload.createdAt = now;
    joinReqPayload.source = 'bootstrapSignup_v1';
  }

  batch.set(joinReqRef, joinReqPayload, { merge: true });

  await batch.commit();

  await auditLog({
    action: 'bootstrapSignup_join_request',
    actorUid: uid,
    actorEmail: email || null,
    orgId: organizationId,
    after: { organizationId, requestedRole, status: 'pending' },
  });

  return { ok: true, mode: 'pending', organizationId };
});

export const finalizeOrganizationSignup = functions.https.onCall(async (_data, context) => {
  const uid = requireAuth(context);

  const authUser = await admin.auth().getUser(uid).catch(() => null);
  if (!authUser?.emailVerified) throw httpsError('failed-precondition', 'Email no verificado.');

  const requestRef = db.collection('organizationSignupRequests').doc(uid);
  const requestSnap = await requestRef.get();

  if (!requestSnap.exists) {
    return { ok: true, mode: 'noop' };
  }

  const requestData = requestSnap.data() as any;
  const organizationId = sanitizeOrganizationId(String(requestData?.organizationId ?? ''));
  if (!organizationId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const orgRef = db.collection('organizations').doc(organizationId);
  const orgPublicRef = db.collection('organizationsPublic').doc(organizationId);
  const orgSnap = await orgRef.get();

  if (orgSnap.exists) {
    await requestRef.delete();
    return { ok: true, mode: 'already_exists', organizationId };
  }

  const orgDetails = requestData?.organizationDetails ?? {};
  const orgName = String(orgDetails?.name ?? requestData?.organizationName ?? organizationId).trim() || organizationId;
  const orgLegalName = String(orgDetails?.legalName ?? requestData?.organizationLegalName ?? '').trim() || null;
  const isDemoOrg = organizationId.startsWith('demo-');
  const organizationType = isDemoOrg ? 'demo' : 'standard';
  const demoExpiresAt = isDemoOrg
    ? admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      )
    : null;

  const userRef = db.collection('users').doc(uid);
  const memberRef = orgRef.collection('members').doc(uid);
  const membershipRef = db.collection('memberships').doc(`${uid}_${organizationId}`);

  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const [userSnapTx, orgSnapTx] = await tx.getAll(userRef, orgRef);
    if (orgSnapTx.exists) {
      return;
    }

    const userData = userSnapTx.exists ? (userSnapTx.data() as any) : null;
    const { accountPlan, createdOrganizationsCount, createdOrganizationsLimit, demoUsedAt } =
      getUserOrgQuota(userData);

    if (!isDemoOrg && createdOrganizationsCount >= createdOrganizationsLimit) {
      throw httpsError(
        'failed-precondition',
        'Has alcanzado el límite de organizaciones permitidas.',
      );
    }

    if (isDemoOrg && demoUsedAt) {
      throw httpsError(
        'failed-precondition',
        'Ya utilizaste tu organización demo. No es posible crear otra.',
      );
    }

    const userCreatedAt = userSnapTx.exists
      ? userSnapTx.get('createdAt') ?? now
      : now;

    tx.create(orgRef, {
      organizationId,
      name: orgName,
      legalName: orgLegalName,
      taxId: String(orgDetails?.taxId ?? '').trim() || null,
      country: String(orgDetails?.country ?? '').trim() || null,
      address: String(orgDetails?.address ?? '').trim() || null,
      billingEmail: String(orgDetails?.billingEmail ?? '').trim() || authUser?.email || null,
      contactPhone: String(orgDetails?.phone ?? '').trim() || null,
      teamSize: Number.isFinite(Number(orgDetails?.teamSize)) ? Number(orgDetails?.teamSize) : null,
      subscriptionPlan: 'trial',
      isActive: true,
      type: organizationType,
      status: 'active',
      entitlement: buildEntitlementPayload({
        planId: 'free',
        status: 'trialing',
        trialEndsAt: demoExpiresAt ?? undefined,
        now,
      }),
      settings: {
        allowGuestAccess: false,
        maxUsers: 50,
        inviteOnly: false,
      },
      demoExpiresAt,
      createdByUserId: uid,
      createdAt: now,
      updatedAt: now,
      source: 'bootstrapSignup_v1',
    });

    tx.create(orgPublicRef, {
      organizationId,
      name: orgName,
      nameLower: orgName.toLowerCase(),
      isActive: true,
      type: organizationType,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      source: 'bootstrapSignup_v1',
    });

    tx.set(
      userRef,
      {
        organizationId,
        email: authUser?.email ?? null,
        displayName: authUser?.displayName ?? authUser?.email ?? 'Usuario',
        role: 'super_admin',
        active: true,
        accountPlan,
        createdOrganizationsCount: createdOrganizationsCount + (isDemoOrg ? 0 : 1),
        createdOrganizationsLimit,
        demoUsedAt: isDemoOrg ? now : demoUsedAt ?? null,
        updatedAt: now,
        createdAt: userCreatedAt,
        source: 'bootstrapSignup_v1',
      },
      { merge: true },
    );

    tx.create(membershipRef, {
      userId: uid,
      organizationId,
      organizationName: orgName,
      role: 'super_admin',
      status: 'active',
      primary: true,
      createdAt: now,
      updatedAt: now,
      source: 'bootstrapSignup_v1',
    });

    tx.create(memberRef, {
      uid,
      orgId: organizationId,
      email: authUser?.email ?? null,
      displayName: authUser?.displayName ?? authUser?.email ?? 'Usuario',
      role: 'super_admin',
      active: true,
      createdAt: now,
      updatedAt: now,
      source: 'bootstrapSignup_v1',
    });

    tx.delete(requestRef);
  });

  await requestRef.delete().catch(() => null);

  await auditLog({
    action: 'bootstrapSignup_create_org',
    actorUid: uid,
    actorEmail: authUser?.email ?? null,
    orgId: organizationId,
    after: { organizationId, role: 'super_admin', status: 'active' },
  });

  return { ok: true, mode: 'created', organizationId };
});

export const setActiveOrganization = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const membershipRef = db.collection('memberships').doc(`${uid}_${orgId}`);
  const mSnap = await membershipRef.get();
  if (!mSnap.exists) throw httpsError('permission-denied', 'No perteneces a esa organización.');

  const status =
    String(mSnap.get('status') ?? '') ||
    (mSnap.get('active') === true ? 'active' : 'pending');
  if (status !== 'active') throw httpsError('failed-precondition', 'La membresía no está activa.');

  const role = normalizeRole(mSnap.get('role'));
  const email = ((context.auth?.token as any)?.email ?? null) as string | null;
  const displayName =
    (((context.auth?.token as any)?.name ?? null) as string | null) ?? email;
  const now = admin.firestore.FieldValue.serverTimestamp();

  // 1) Persist active org on the user
  // 2) Make selected membership primary
  // 3) Ensure org-scoped member doc exists (used by UI list + rules)
  const batch = db.batch();
  batch.set(
    db.collection('users').doc(uid),
    {
      organizationId: orgId,
      updatedAt: now,
      source: 'setActiveOrganization_v2',
    },
    { merge: true },
  );

  batch.set(
    membershipRef,
    {
      primary: true,
      updatedAt: now,
      source: 'setActiveOrganization_v2',
    },
    { merge: true },
  );

  batch.set(
    db.collection('organizations').doc(orgId).collection('members').doc(uid),
    {
      uid,
      orgId,
      active: true,
      role,
      email,
      displayName,
      updatedAt: now,
      source: 'setActiveOrganization_v2',
    },
    { merge: true },
  );

  await batch.commit();

  // Best-effort: unset primary on other memberships for this user.
  // Not critical for correctness; avoids UI drift where an old org stays primary.
  try {
    const others = await db.collection('memberships').where('userId', '==', uid).get();
    const batch2 = db.batch();
    let writes = 0;
    for (const d of others.docs) {
      if (d.id !== `${uid}_${orgId}` && d.get('primary') === true) {
        batch2.set(
          d.ref,
          {
            primary: false,
            updatedAt: now,
            source: 'setActiveOrganization_v2',
          },
          { merge: true },
        );
        writes += 1;
      }
    }
    if (writes > 0) {
      await batch2.commit();
    }
  } catch {
    // ignore
  }

  return { ok: true, organizationId: orgId };
});


/* ------------------------------
   ENTITLEMENT-LIMITED CREATION
--------------------------------- */

export const createSite = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);

  const { role } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(role, ADMIN_LIKE_ROLES, 'No tienes permisos para crear ubicaciones.');

  if (!isPlainObject(data?.payload)) throw httpsError('invalid-argument', 'payload requerido.');

  const name = requireStringField(data.payload.name, 'name');
  const code = requireStringField(data.payload.code, 'code');

  const orgRef = db.collection('organizations').doc(orgId);
  const siteRef = orgRef.collection('sites').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    ensureEntitlementAllowsCreate({ kind: 'sites', entitlement, features });

    tx.create(siteRef, {
      name,
      code,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
      source: 'createSite_v1',
    });
    tx.update(orgRef, {
      [`entitlement.usage.${USAGE_FIELDS.sites}`]: admin.firestore.FieldValue.increment(1),
      'entitlement.updatedAt': now,
    });
  });

  await auditLog({
    action: 'createSite',
    actorUid,
    actorEmail,
    orgId,
    after: { siteId: siteRef.id, name, code },
  });

  return { ok: true, organizationId: orgId, siteId: siteRef.id };
});

export const createDepartment = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);

  const { role } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(role, ADMIN_LIKE_ROLES, 'No tienes permisos para crear departamentos.');

  if (!isPlainObject(data?.payload)) throw httpsError('invalid-argument', 'payload requerido.');

  const name = requireStringField(data.payload.name, 'name');
  const code = requireStringField(data.payload.code, 'code');

  const orgRef = db.collection('organizations').doc(orgId);
  const departmentRef = orgRef.collection('departments').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    ensureEntitlementAllowsCreate({ kind: 'departments', entitlement, features });

    tx.create(departmentRef, {
      name,
      code,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
      source: 'createDepartment_v1',
    });
    tx.update(orgRef, {
      [`entitlement.usage.${USAGE_FIELDS.departments}`]: admin.firestore.FieldValue.increment(1),
      'entitlement.updatedAt': now,
    });
  });

  await auditLog({
    action: 'createDepartment',
    actorUid,
    actorEmail,
    orgId,
    after: { departmentId: departmentRef.id, name, code },
  });

  return { ok: true, organizationId: orgId, departmentId: departmentRef.id };
});

// -----------------------------
// Tickets & Tasks (server-only writes)
// -----------------------------

export const createTicketUploadSession = functions.https.onCall(async (data, context) => {
  try {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const orgId = String(data?.orgId ?? data?.organizationId ?? '').trim();
    const ticketId = String(data?.ticketId ?? '').trim();
    const maxFiles = Math.min(Number(data?.maxFiles ?? 10) || 10, 10);

    if (!orgId || !ticketId) {
      throw new functions.https.HttpsError('invalid-argument', 'Faltan orgId o ticketId.');
    }

    return await db.runTransaction(async (tx) => {
      await requireActiveMembershipForTx(tx, orgId, uid);

      const orgRef = db.collection('organizations').doc(orgId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Organización no encontrada.');
      }

      const entitlement = resolveEffectiveEntitlementForTx(orgSnap);
      const effectiveLimits = await resolvePlanLimitsForTx(tx, entitlement.planId, entitlement.limits);
      const maxAttachmentMB = Number(effectiveLimits.maxAttachmentMB ?? 0) || 0;
      const monthlyMB = Number(effectiveLimits.attachmentsMonthlyMB ?? 0) || 0;
      const perTicket = Number(effectiveLimits.maxAttachmentsPerTicket ?? 0) || 0;

      if (monthlyMB <= 0 || maxAttachmentMB <= 0 || perTicket <= 0) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Los adjuntos no están disponibles en tu plan.',
          'attachments_not_allowed'
        );
      }

      // Create short-lived session for Storage rules.
      const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000));
      const sessionRef = orgRef.collection('uploadSessions').doc(ticketId);

      tx.set(sessionRef, {
        organizationId: orgId,
        uploaderUid: uid,
        type: 'ticket',
        status: 'active',
        allowedFiles: {},
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
        maxFiles,
      });

      functions.logger.info('Created ticket upload session', {
        orgId,
        ticketId,
        uploaderUid: uid,
        maxFiles,
        maxAttachmentMB,
        expiresAt: expiresAt.toDate().toISOString(),
      });

      return {
        ok: true,
        ticketId,
        expiresAt: expiresAt.toDate().toISOString(),
        maxFiles,
        maxAttachmentMB,
      };
    });
  } catch (error: any) {
    functions.logger.error('createTicketUploadSession failed', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });
    if (error instanceof functions.https.HttpsError || error?.constructor?.name === 'HttpsError') {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Error interno creando sesión de subida.', {
      reason: 'createTicketUploadSession_failed',
    });
  }
});

export const registerTicketAttachment = functions.https.onCall(async (data, context) => {
  try {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const orgId = String(data?.orgId ?? data?.organizationId ?? '').trim();
    const ticketId = String(data?.ticketId ?? '').trim();
    const sizeBytes = Number(data?.sizeBytes ?? 0) || 0;
    const fileName = String(data?.fileName ?? '').trim();
    const contentType = String(data?.contentType ?? '').trim();

    if (!orgId || !ticketId || sizeBytes <= 0 || !fileName || !contentType) {
      throw new functions.https.HttpsError('invalid-argument', 'Faltan orgId, ticketId, sizeBytes, fileName o contentType.');
    }

    const sizeMB = sizeBytes / (1024 * 1024);

    return await db.runTransaction(async (tx) => {
      await requireActiveMembershipForTx(tx, orgId, uid);

      const orgRef = db.collection('organizations').doc(orgId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Organización no encontrada.');
      }

      const entitlement = resolveEffectiveEntitlementForTx(orgSnap);
      const effectiveLimits = await resolvePlanLimitsForTx(tx, entitlement.planId, entitlement.limits);
      const maxAttachmentMB = Number(effectiveLimits.maxAttachmentMB ?? 0) || 0;
      const monthlyMB = Number(effectiveLimits.attachmentsMonthlyMB ?? 0) || 0;
      const perTicket = Number(effectiveLimits.maxAttachmentsPerTicket ?? 0) || 0;
      const usedThisMonth = Number(entitlement.usage?.attachmentsThisMonthMB ?? 0) || 0;

      if (monthlyMB <= 0 || maxAttachmentMB <= 0 || perTicket <= 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Los adjuntos no están disponibles en tu plan.', 'attachments_not_allowed');
      }

      if (sizeMB > maxAttachmentMB + 1e-6) {
        throw new functions.https.HttpsError('failed-precondition', `Adjunto supera el tamaño máximo (${maxAttachmentMB} MB).`, 'attachment_too_large');
      }

      if (usedThisMonth + sizeMB > monthlyMB + 1e-6) {
        throw new functions.https.HttpsError('failed-precondition', 'Se superó la cuota mensual de adjuntos.', 'attachments_quota_exceeded');
      }

      const sessionRef = orgRef.collection('uploadSessions').doc(ticketId);
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists || sessionSnap.get('status') !== 'active' || sessionSnap.get('type') !== 'ticket') {
        functions.logger.warn('Upload session inactive or missing', {
          orgId,
          ticketId,
          uploaderUid: uid,
          sessionExists: sessionSnap.exists,
          sessionStatus: sessionSnap.get('status'),
          sessionType: sessionSnap.get('type'),
        });
        throw new functions.https.HttpsError('failed-precondition', 'La sesión de carga no está activa.', 'upload_session_inactive');
      }
      if (sessionSnap.get('uploaderUid') !== uid) {
        functions.logger.warn('Upload session uploader mismatch', {
          orgId,
          ticketId,
          uploaderUid: uid,
          sessionUploaderUid: sessionSnap.get('uploaderUid'),
        });
        throw new functions.https.HttpsError('permission-denied', 'Sesión de carga inválida.');
      }

      const allowedFiles = (sessionSnap.get('allowedFiles') || {}) as Record<string, { sizeBytes?: number }>;
      if (allowedFiles[fileName]) {
        throw new functions.https.HttpsError('already-exists', 'El archivo ya fue registrado.');
      }

      const maxFiles = Number(sessionSnap.get('maxFiles') ?? 0) || 0;
      const registeredCount = Object.keys(allowedFiles).length;
      if (maxFiles > 0 && registeredCount >= maxFiles) {
        throw new functions.https.HttpsError('failed-precondition', `Se superó el máximo de adjuntos por incidencia (${maxFiles}).`, 'attachments_per_ticket_exceeded');
      }

      const ticketRef = orgRef.collection('tickets').doc(ticketId);
      const ticketSnap = await tx.get(ticketRef);
      if (ticketSnap.exists) {
        const currentUrls = Array.isArray(ticketSnap.get('photoUrls')) ? (ticketSnap.get('photoUrls') as unknown[]) : [];
        if (currentUrls.length >= perTicket) {
          throw new functions.https.HttpsError('failed-precondition', `Se superó el máximo de adjuntos por incidencia (${perTicket}).`, 'attachments_per_ticket_exceeded');
        }
      }

      tx.update(orgRef, {
        'entitlement.usage.attachmentsThisMonthMB': admin.firestore.FieldValue.increment(sizeMB),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.update(
        sessionRef,
        new admin.firestore.FieldPath('allowedFiles', fileName),
        {
          sizeBytes,
          contentType,
          registeredAt: admin.firestore.FieldValue.serverTimestamp(),
        }
      );

      return { ok: true, sizeMB };
    });
  } catch (error: any) {
    functions.logger.error('registerTicketAttachment failed', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });
    if (error instanceof functions.https.HttpsError || error?.constructor?.name === 'HttpsError') {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Error interno registrando adjunto.', {
      reason: 'registerTicketAttachment_failed',
    });
  }
});

export const createTicket = functions.https.onCall(async (data, context) => {
  try {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const orgId = String(data?.orgId ?? data?.organizationId ?? '').trim();
    const payload = (data?.payload ?? data) as Record<string, any>;
    const providedTicketId = String(payload?.ticketId ?? data?.ticketId ?? '').trim() || undefined;

    if (!orgId) {
      throw new functions.https.HttpsError('invalid-argument', 'Falta orgId.');
    }

    return await db.runTransaction(async (tx) => {
      const resolved = await requireActiveMembershipForTx(tx, orgId, uid);

      const orgRef = db.collection('organizations').doc(orgId);
      const orgSnap = await tx.get(orgRef);
      if (!orgSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Organización no encontrada.');
      }

      const entitlement = resolveEffectiveEntitlementForTx(orgSnap);
      const limits = entitlement.limits;
      const usage = entitlement.usage;

      const locationId = String(payload?.locationId ?? payload?.siteId ?? '').trim();
      const originDepartmentId = String(payload?.originDepartmentId ?? '').trim() || undefined;
      const targetDepartmentId = String(payload?.targetDepartmentId ?? '').trim() || undefined;
      const departmentId = String(payload?.departmentId ?? '').trim() || undefined;
      const effectiveDepartmentId = targetDepartmentId ?? originDepartmentId ?? departmentId;

      if (!locationId) {
        throw new functions.https.HttpsError('invalid-argument', 'Falta locationId.');
      }
      if (!effectiveDepartmentId) {
        throw new functions.https.HttpsError('invalid-argument', 'Falta departmentId.');
      }

      // Scope enforcement (keep existing RBAC model; don't redesign).
      requireScopedAccessToSite(resolved.role, resolved.scope, locationId);
      requireScopedAccessToDepartment(resolved.role, resolved.scope, effectiveDepartmentId);

      const status = payload?.status ?? 'new';
      if (isOpenStatus(status)) {
        const current = Number(usage?.openTicketsCount ?? 0) || 0;
        const max = Number(limits?.maxOpenTickets ?? 0) || 0;
        if (max > 0 && current >= max) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Has alcanzado el límite de incidencias abiertas de tu plan.',
            'max_open_tickets_reached'
          );
        }
      }

      const ticketRef = providedTicketId
        ? orgRef.collection('tickets').doc(providedTicketId)
        : orgRef.collection('tickets').doc();

      const existing = await tx.get(ticketRef);
      if (existing.exists) {
        throw new functions.https.HttpsError('already-exists', 'La incidencia ya existe.');
      }

      // Read upload session (if any) BEFORE any writes in the transaction.
      const sessionRef = orgRef.collection('uploadSessions').doc(ticketRef.id);
      const sessionSnap = await tx.get(sessionRef);

      const nowYear = new Date().getFullYear();
      const displayId = payload?.displayId || `INC-${nowYear}-${String(Date.now()).slice(-4)}`;

      const createdByName = String(payload?.createdByName ?? resolved.userData?.displayName ?? resolved.userData?.email ?? uid);

      const docData: Record<string, any> = {
        organizationId: orgId,
        locationId,
        originDepartmentId: originDepartmentId ?? null,
        targetDepartmentId: targetDepartmentId ?? null,
        departmentId: departmentId ?? null,
        title: String(payload?.title ?? '').trim(),
        description: String(payload?.description ?? '').trim(),
        type: payload?.type ?? 'correctivo',
        status,
        priority: payload?.priority ?? 'Media',
        assetId: payload?.assetId ?? null,
        createdBy: uid,
        createdByName,
        assignedRole: payload?.assignedRole ?? 'mantenimiento',
        assignedTo: payload?.assignedTo ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        displayId,
        photoUrls: Array.isArray(payload?.photoUrls) ? payload.photoUrls : [],
        hasAttachments: Array.isArray(payload?.photoUrls) && payload.photoUrls.length > 0,
      };

      // Clean null-ish legacy.
      if (!docData.assetId) delete docData.assetId;

      tx.set(ticketRef, docData, { merge: false });

      if (isOpenStatus(status)) {
        tx.update(orgRef, {
          'entitlement.usage.openTicketsCount': admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Clean up upload session if present.
      if (sessionSnap.exists) {
        tx.delete(sessionRef);
      }

      return { ok: true, ticketId: ticketRef.id };
    });
  } catch (error: any) {
    functions.logger.error('createTicket failed', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });
    if (error instanceof functions.https.HttpsError || error?.constructor?.name === 'HttpsError') {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'Error interno creando incidencia.', {
      reason: 'createTicket_failed',
    });
  }
});

export const updateTicketStatus = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const orgId = String(data?.orgId ?? data?.organizationId ?? '').trim();
  const ticketId = String(data?.ticketId ?? '').trim();
  const newStatus = data?.newStatus;
  const patch = (data?.patch ?? {}) as Record<string, any>;
  const reportAppend = data?.reportAppend as { description?: string } | undefined;

  if (!orgId || !ticketId) {
    throw new functions.https.HttpsError('invalid-argument', 'Faltan orgId o ticketId.');
  }

  return await db.runTransaction(async (tx) => {
    const resolved = await requireActiveMembershipForTx(tx, orgId, uid);
    const orgRef = db.collection('organizations').doc(orgId);
    const ticketRef = orgRef.collection('tickets').doc(ticketId);

    const [orgSnap, ticketSnap] = await Promise.all([tx.get(orgRef), tx.get(ticketRef)]);

    if (!orgSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Organización no encontrada.');
    }
    if (!ticketSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Incidencia no encontrada.');
    }

    const entitlement = resolveEffectiveEntitlementForTx(orgSnap);
    const limits = entitlement.limits;
    const usage = entitlement.usage;

    const oldStatus = ticketSnap.get('status');
    const effectiveNewStatus = newStatus ?? patch?.status ?? oldStatus;

    const wasOpen = isOpenStatus(oldStatus);
    const willBeOpen = isOpenStatus(effectiveNewStatus);

    if (!wasOpen && willBeOpen) {
      const current = Number(usage?.openTicketsCount ?? 0) || 0;
      const max = Number(limits?.maxOpenTickets ?? 0) || 0;
      if (max > 0 && current >= max) {
        throw new functions.https.HttpsError('failed-precondition', 'Has alcanzado el límite de incidencias abiertas de tu plan.', 'max_open_tickets_reached');
      }
    }

    // Scope enforcement for scoped roles when changing scope-related fields.
    const nextLocationId = String((patch?.locationId ?? patch?.siteId ?? ticketSnap.get('locationId') ?? '')).trim();
    const nextOriginDept = String((patch?.originDepartmentId ?? ticketSnap.get('originDepartmentId') ?? '')).trim();
    const nextTargetDept = String((patch?.targetDepartmentId ?? ticketSnap.get('targetDepartmentId') ?? '')).trim();
    const nextLegacyDept = String((patch?.departmentId ?? ticketSnap.get('departmentId') ?? '')).trim();
    const nextDept = nextTargetDept || nextOriginDept || nextLegacyDept;

    if (nextLocationId) {
      requireScopedAccessToSite(resolved.role, resolved.scope, nextLocationId);
    }
    if (nextDept) {
      requireScopedAccessToDepartment(resolved.role, resolved.scope, nextDept);
    }

    const updateData: Record<string, any> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      organizationId: orgId,
      ...patch,
    };

    if (newStatus !== undefined) {
      updateData.status = effectiveNewStatus;
    }

    // Closure metadata (keep existing semantics used by UI).
    const normalizedNew = normalizeStatus(effectiveNewStatus);
    if (['resolved', 'closed', 'cerrada', 'resuelta', 'canceled', 'cancelled', 'cancelada'].includes(normalizedNew)) {
      if (!ticketSnap.get('closedAt')) {
        updateData.closedAt = admin.firestore.FieldValue.serverTimestamp();
      }
      updateData.closedBy = uid;
    }

    // Report append (used by incident details page).
    if (reportAppend?.description && String(reportAppend.description).trim().length > 0) {
      const entry = {
        description: String(reportAppend.description).trim(),
        createdAt: admin.firestore.Timestamp.now(),
        createdBy: uid,
      };
      updateData.reports = admin.firestore.FieldValue.arrayUnion(entry);
    }

    tx.update(ticketRef, updateData);

    if (wasOpen !== willBeOpen) {
      tx.update(orgRef, {
        'entitlement.usage.openTicketsCount': admin.firestore.FieldValue.increment(willBeOpen ? 1 : -1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { ok: true };
  });
});

export const createTask = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const orgId = String(data?.orgId ?? data?.organizationId ?? '').trim();
  const payload = (data?.payload ?? data) as Record<string, any>;
  const providedTaskId = String(payload?.taskId ?? data?.taskId ?? '').trim() || undefined;

  if (!orgId) {
    throw new functions.https.HttpsError('invalid-argument', 'Falta orgId.');
  }

  return await db.runTransaction(async (tx) => {
    const resolved = await requireActiveMembershipForTx(tx, orgId, uid);
    const orgRef = db.collection('organizations').doc(orgId);
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Organización no encontrada.');
    }

    const entitlement = resolveEffectiveEntitlementForTx(orgSnap);
    const limits = entitlement.limits;
    const usage = entitlement.usage;

    const status = payload?.status ?? 'open';
    if (isOpenStatus(status)) {
      const current = Number(usage?.openTasksCount ?? 0) || 0;
      const max = Number(limits?.maxOpenTasks ?? 0) || 0;
      if (max > 0 && current >= max) {
        throw new functions.https.HttpsError('failed-precondition', 'Has alcanzado el límite de tareas abiertas de tu plan.', 'max_open_tasks_reached');
      }
    }

    const locationId = String(payload?.locationId ?? '').trim();
    const originDepartmentId = String(payload?.originDepartmentId ?? '').trim() || undefined;
    const targetDepartmentId = String(payload?.targetDepartmentId ?? '').trim() || undefined;
    const departmentId = String(payload?.departmentId ?? '').trim() || undefined;
    const effectiveDepartmentId = targetDepartmentId ?? originDepartmentId ?? departmentId;

    if (locationId) {
      requireScopedAccessToSite(resolved.role, resolved.scope, locationId);
    }
    if (effectiveDepartmentId) {
      requireScopedAccessToDepartment(resolved.role, resolved.scope, effectiveDepartmentId);
    }

    const taskRef = providedTaskId ? orgRef.collection('tasks').doc(providedTaskId) : orgRef.collection('tasks').doc();
    const existing = await tx.get(taskRef);
    if (existing.exists) {
      throw new functions.https.HttpsError('already-exists', 'La tarea ya existe.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();

    const docData: Record<string, any> = {
      ...payload,
      organizationId: orgId,
      createdBy: uid,
      status,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(taskRef, docData, { merge: false });

    if (isOpenStatus(status)) {
      tx.update(orgRef, {
        'entitlement.usage.openTasksCount': admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { ok: true, taskId: taskRef.id };
  });
});

export const updateTaskStatus = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const orgId = String(data?.orgId ?? data?.organizationId ?? '').trim();
  const taskId = String(data?.taskId ?? '').trim();
  const newStatus = data?.newStatus;
  const patch = (data?.patch ?? {}) as Record<string, any>;
  const reportAppend = data?.reportAppend as { description?: string } | undefined;

  if (!orgId || !taskId) {
    throw new functions.https.HttpsError('invalid-argument', 'Faltan orgId o taskId.');
  }

  return await db.runTransaction(async (tx) => {
    const resolved = await requireActiveMembershipForTx(tx, orgId, uid);
    const orgRef = db.collection('organizations').doc(orgId);
    const taskRef = orgRef.collection('tasks').doc(taskId);

    const [orgSnap, taskSnap] = await Promise.all([tx.get(orgRef), tx.get(taskRef)]);
    if (!orgSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Organización no encontrada.');
    }
    if (!taskSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Tarea no encontrada.');
    }

    const entitlement = resolveEffectiveEntitlementForTx(orgSnap);
    const limits = entitlement.limits;
    const usage = entitlement.usage;

    const oldStatus = taskSnap.get('status');
    const effectiveNewStatus = newStatus ?? patch?.status ?? oldStatus;
    const wasOpen = isOpenStatus(oldStatus);
    const willBeOpen = isOpenStatus(effectiveNewStatus);

    if (!wasOpen && willBeOpen) {
      const current = Number(usage?.openTasksCount ?? 0) || 0;
      const max = Number(limits?.maxOpenTasks ?? 0) || 0;
      if (max > 0 && current >= max) {
        throw new functions.https.HttpsError('failed-precondition', 'Has alcanzado el límite de tareas abiertas de tu plan.', 'max_open_tasks_reached');
      }
    }

    const nextLocationId = String((patch?.locationId ?? taskSnap.get('locationId') ?? '')).trim();
    const nextOriginDept = String((patch?.originDepartmentId ?? taskSnap.get('originDepartmentId') ?? '')).trim();
    const nextTargetDept = String((patch?.targetDepartmentId ?? taskSnap.get('targetDepartmentId') ?? '')).trim();
    const nextLegacyDept = String((patch?.departmentId ?? taskSnap.get('departmentId') ?? '')).trim();
    const nextDept = nextTargetDept || nextOriginDept || nextLegacyDept;

    if (nextLocationId) {
      requireScopedAccessToSite(resolved.role, resolved.scope, nextLocationId);
    }
    if (nextDept) {
      requireScopedAccessToDepartment(resolved.role, resolved.scope, nextDept);
    }

    const updateData: Record<string, any> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      organizationId: orgId,
      ...patch,
    };

    if (newStatus !== undefined) {
      updateData.status = effectiveNewStatus;
    }

    const normalizedNew = normalizeStatus(effectiveNewStatus);
    if (['done', 'closed', 'resolved', 'cerrada', 'resuelta', 'canceled', 'cancelled', 'cancelada'].includes(normalizedNew)) {
      if (!taskSnap.get('closedAt')) {
        updateData.closedAt = admin.firestore.FieldValue.serverTimestamp();
      }
      updateData.closedBy = uid;
    }

    if (reportAppend?.description && String(reportAppend.description).trim().length > 0) {
      const entry = {
        description: String(reportAppend.description).trim(),
        createdAt: admin.firestore.Timestamp.now(),
        createdBy: uid,
      };
      updateData.reports = admin.firestore.FieldValue.arrayUnion(entry);
    }

    tx.update(taskRef, updateData);

    if (wasOpen !== willBeOpen) {
      tx.update(orgRef, {
        'entitlement.usage.openTasksCount': admin.firestore.FieldValue.increment(willBeOpen ? 1 : -1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { ok: true };
  });
});

export const deleteTask = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const orgId = String(data?.orgId ?? data?.organizationId ?? '').trim();
  const taskId = String(data?.taskId ?? '').trim();
  if (!orgId || !taskId) {
    throw new functions.https.HttpsError('invalid-argument', 'Faltan orgId o taskId.');
  }

  return await db.runTransaction(async (tx) => {
    const resolved = await requireActiveMembershipForTx(tx, orgId, uid);
    requireRoleAllowed(resolved.role, TASKS_ROLES, 'No tienes permisos para eliminar tareas.');

    const orgRef = db.collection('organizations').doc(orgId);
    const taskRef = orgRef.collection('tasks').doc(taskId);
    const [orgSnap, taskSnap] = await Promise.all([tx.get(orgRef), tx.get(taskRef)]);
    if (!orgSnap.exists) throw new functions.https.HttpsError('not-found', 'Organización no encontrada.');
    if (!taskSnap.exists) throw new functions.https.HttpsError('not-found', 'Tarea no encontrada.');

    const oldStatus = taskSnap.get('status');
    const wasOpen = isOpenStatus(oldStatus);

    tx.delete(taskRef);

    if (wasOpen) {
      tx.update(orgRef, {
        'entitlement.usage.openTasksCount': admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { ok: true };
  });
});


export const createAsset = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);

  const { role, scope } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para crear activos.');

  if (!isPlainObject(data?.payload)) throw httpsError('invalid-argument', 'payload requerido.');

  const name = requireStringField(data.payload.name, 'name');
  const code = requireStringField(data.payload.code, 'code');
  const siteId = requireStringField(data.payload.siteId, 'siteId');

  requireScopedAccessToSite(role, scope, siteId);

  const orgRef = db.collection('organizations').doc(orgId);
  const siteRef = orgRef.collection('sites').doc(siteId);
  const assetRef = orgRef.collection('assets').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const siteSnap = await tx.get(siteRef);
    if (!siteSnap.exists || String(siteSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
    }

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    ensureEntitlementAllowsCreate({ kind: 'assets', entitlement, features });

    tx.create(assetRef, {
      name,
      code,
      siteId,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
      source: 'createAsset_v1',
    });
    tx.update(orgRef, {
      [`entitlement.usage.${USAGE_FIELDS.assets}`]: admin.firestore.FieldValue.increment(1),
      'entitlement.updatedAt': now,
    });
  });

  await auditLog({
    action: 'createAsset',
    actorUid,
    actorEmail,
    orgId,
    after: { assetId: assetRef.id, name, code, siteId },
  });

  return { ok: true, organizationId: orgId, assetId: assetRef.id };
});

export const createPreventive = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);

  const { role, scope } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(
    role,
    new Set<Role>([...ADMIN_LIKE_ROLES, ...SCOPED_HEAD_ROLES]),
    'No tienes permisos para crear preventivos.',
  );

  if (!isPlainObject(data?.payload)) throw httpsError('invalid-argument', 'payload requerido.');

  const payload = data.payload;
  const title = requireStringField(payload.title, 'title');
  const siteId = requireStringField(payload.siteId, 'siteId');
  const departmentId = requireStringField(payload.departmentId, 'departmentId');

  requireScopedAccessToDepartment(role, scope, departmentId);
  requireScopedAccessToSite(role, scope, siteId);

  const orgRef = db.collection('organizations').doc(orgId);
  const siteRef = orgRef.collection('sites').doc(siteId);
  const departmentRef = orgRef.collection('departments').doc(departmentId);
  const assetId = String(payload.assetId ?? '').trim();
  const assetRef = assetId ? orgRef.collection('assets').doc(assetId) : null;
  const ticketRef = orgRef.collection('tickets').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const [siteSnap, departmentSnap] = await Promise.all([tx.get(siteRef), tx.get(departmentRef)]);
    if (!siteSnap.exists || String(siteSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
    }
    if (!departmentSnap.exists || String(departmentSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('failed-precondition', 'El departamento indicado no existe en esta organización.');
    }

    if (assetRef) {
      const assetSnap = await tx.get(assetRef);
      if (!assetSnap.exists || String(assetSnap.get('organizationId') ?? '') !== orgId) {
        throw httpsError('failed-precondition', 'El activo indicado no existe en esta organización.');
      }
    }

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    ensureEntitlementAllowsCreate({ kind: 'preventives', entitlement, features });

    const sanitizedPayload = {
      ...payload,
      title,
      siteId,
      departmentId,
      assetId: assetId || null,
      status: String(payload.status ?? 'new'),
      type: 'preventivo',
      organizationId: orgId,
      createdBy: actorUid,
      createdAt: now,
      updatedAt: now,
      source: 'createPreventive_v1',
    };

    tx.create(ticketRef, sanitizedPayload);
    tx.update(orgRef, {
      [`entitlement.usage.${USAGE_FIELDS.preventives}`]: admin.firestore.FieldValue.increment(1),
      'entitlement.updatedAt': now,
    });
  });

  await auditLog({
    action: 'createPreventive',
    actorUid,
    actorEmail,
    orgId,
    after: { ticketId: ticketRef.id, title, siteId, departmentId },
  });

  return { ok: true, organizationId: orgId, ticketId: ticketRef.id };
});


export const createPreventiveTemplate = functions.https.onCall(async (data, context) => {
  try {
    const actorUid = requireAuth(context);
    const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
    const orgId = resolveOrgIdFromData(data);

  const { role, scope } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(
    role,
    MASTER_DATA_ROLES,
    'No tienes permisos para crear plantillas preventivas.',
  );

  if (!isPlainObject(data)) throw httpsError('invalid-argument', 'payload requerido.');

  const name = requireStringField(data.name, 'name');
  const description = String(data.description ?? '').trim();
  const status = String(data.status ?? 'active').trim();
  const automatic = Boolean(data.automatic);
  const priority = String(data.priority ?? 'Media').trim();
  const siteId = String(data.siteId ?? '').trim();
  const departmentId = String(data.departmentId ?? '').trim();
  const assetId = String(data.assetId ?? '').trim();

  const checklistRaw = Array.isArray((data as any).checklist) ? (data as any).checklist : [];
  const checklist = normalizeChecklistItems(checklistRaw);

    if (!isPlainObject(data.schedule)) throw httpsError('invalid-argument', 'schedule requerido.');

  const scheduleType = String(data.schedule.type ?? '').trim();
  if (!['daily', 'weekly', 'monthly', 'date'].includes(scheduleType)) {
    throw httpsError('invalid-argument', 'schedule.type inválido.');
  }

  if (automatic && status === 'active') {
    if (!siteId) throw httpsError('invalid-argument', 'siteId requerido para preventivos automáticos activos.');
    if (!departmentId) throw httpsError('invalid-argument', 'departmentId requerido para preventivos automáticos activos.');
  }

  requireScopedAccessToSite(role, scope, siteId);
  requireScopedAccessToDepartment(role, scope, departmentId);

  const timeOfDay = String(data.schedule.timeOfDay ?? '').trim();
  const timezone = String(data.schedule.timezone ?? '').trim();

  const daysOfWeekRaw = Array.isArray(data.schedule.daysOfWeek) ? data.schedule.daysOfWeek : [];
  const daysOfWeek = daysOfWeekRaw
    .map((d) => Number(d))
    .filter((d) => Number.isFinite(d) && d >= 1 && d <= 7);

  const dayOfMonthRaw = data.schedule.dayOfMonth;
  const dayOfMonth = Number.isFinite(Number(dayOfMonthRaw)) ? Number(dayOfMonthRaw) : undefined;

  let dateTs: admin.firestore.Timestamp | undefined;
  if (scheduleType === 'date') {
    const dateStr = String(data.schedule.date ?? '').trim();
    if (!dateStr) throw httpsError('invalid-argument', 'schedule.date requerido para tipo date.');
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) {
      throw httpsError('invalid-argument', 'schedule.date inválido.');
    }
    dateTs = admin.firestore.Timestamp.fromDate(parsed);
  }

  const schedule: PreventiveSchedule = {
    type: scheduleType as PreventiveScheduleType,
    timezone: timezone || undefined,
    timeOfDay: timeOfDay || undefined,
    daysOfWeek: daysOfWeek.length ? daysOfWeek : undefined,
    dayOfMonth: scheduleType === 'monthly' ? dayOfMonth : undefined,
    date: scheduleType === 'date' ? dateTs : undefined,
  };

  const now = admin.firestore.FieldValue.serverTimestamp();
  const orgRef = db.collection('organizations').doc(orgId);
  const templateRef = orgRef.collection('preventiveTemplates').doc();

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');

    const orgData = orgSnap.data() as FirebaseFirestore.DocumentData | undefined;

    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const isDemoOrg = isDemoOrganization(orgId, orgData);
    let features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    let effectiveEntitlement = entitlement;

    if (!isFeatureEnabled({ ...(entitlement as any), features }, 'PREVENTIVES')) {
      const fallbackEntitlement = await resolveFallbackPreventivesEntitlementForTx(
        tx,
        orgData,
        entitlement,
      );
      if (fallbackEntitlement) {
        effectiveEntitlement = fallbackEntitlement.entitlement;
        features = fallbackEntitlement.features;
      }
    }

    ensureEntitlementAllowsCreate({
      kind: 'preventives',
      entitlement: effectiveEntitlement,
      features,
      orgType: String(orgData?.type ?? ''),
    });
    await ensureDemoTemplateLimit(tx, orgRef, isDemoOrg);

    // Validate referenced master data exists when provided.
    if (siteId) {
      const siteSnap = await tx.get(orgRef.collection('sites').doc(siteId));
      if (!siteSnap.exists || String(siteSnap.get('organizationId') ?? '') !== orgId) {
        throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
      }
    }

    if (departmentId) {
      const deptSnap = await tx.get(orgRef.collection('departments').doc(departmentId));
      if (!deptSnap.exists || String(deptSnap.get('organizationId') ?? '') !== orgId) {
        throw httpsError('failed-precondition', 'El departamento indicado no existe en esta organización.');
      }
    }

    if (assetId) {
      const assetSnap = await tx.get(orgRef.collection('assets').doc(assetId));
      if (!assetSnap.exists || String(assetSnap.get('organizationId') ?? '') !== orgId) {
        throw httpsError('failed-precondition', 'El activo indicado no existe en esta organización.');
      }
    }

    const zonedNow = resolveZonedDate(schedule.timezone);
    const computed = automatic && status === 'active' ? computeNextRunAt(schedule, zonedNow) : null;

    const storedSchedule: PreventiveSchedule = stripUndefinedDeep({
      ...schedule,
      nextRunAt: computed ? admin.firestore.Timestamp.fromDate(computed) : undefined,
      lastRunAt: undefined,
    });

    tx.create(
      templateRef,
      stripUndefinedDeep({
        name,
        description: description || undefined,
        status,
        automatic,
        checklist: checklist.length ? checklist : undefined,
        schedule: storedSchedule,
        priority,
        siteId: siteId || undefined,
        departmentId: departmentId || undefined,
        assetId: assetId || undefined,
        createdBy: actorUid,
        updatedBy: actorUid,
        organizationId: orgId,
        createdAt: now,
        updatedAt: now,
        source: 'createPreventiveTemplate_v1',
      }),
    );
  });

    await auditLog({
      action: 'createPreventiveTemplate',
      actorUid,
      actorEmail,
      orgId,
      after: { templateId: templateRef.id, name, status, automatic },
    });

    return { ok: true, organizationId: orgId, templateId: templateRef.id };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    console.error('createPreventiveTemplate: unexpected error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw httpsError('internal', 'Error interno al crear la plantilla preventiva. Inténtalo de nuevo o contacta soporte.');
  }
});

export const updatePreventiveTemplate = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);
  const templateId = requireStringField(data.templateId, 'templateId');

  const { role, scope } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(
    role,
    MASTER_DATA_ROLES,
    'No tienes permisos para editar plantillas preventivas.',
  );

  if (!isPlainObject(data)) throw httpsError('invalid-argument', 'payload requerido.');

  const name = requireStringField(data.name, 'name');
  const description = String(data.description ?? '').trim();
  const status = String(data.status ?? 'active').trim();
  const automatic = Boolean(data.automatic);
  const priority = String(data.priority ?? 'Media').trim();
  const siteId = String(data.siteId ?? '').trim();
  const departmentId = String(data.departmentId ?? '').trim();
  const assetId = String(data.assetId ?? '').trim();

  const checklistRaw = Array.isArray((data as any).checklist) ? (data as any).checklist : [];
  const checklist = normalizeChecklistItems(checklistRaw);

  if (!isPlainObject(data.schedule)) throw httpsError('invalid-argument', 'schedule requerido.');

  const scheduleType = String(data.schedule.type ?? '').trim();
  if (!['daily', 'weekly', 'monthly', 'date'].includes(scheduleType)) {
    throw httpsError('invalid-argument', 'schedule.type inválido.');
  }

  if (automatic && status === 'active') {
    if (!siteId) throw httpsError('invalid-argument', 'siteId requerido para preventivos automáticos activos.');
    if (!departmentId) throw httpsError('invalid-argument', 'departmentId requerido para preventivos automáticos activos.');
  }

  requireScopedAccessToSite(role, scope, siteId);
  requireScopedAccessToDepartment(role, scope, departmentId);

  const timeOfDay = String(data.schedule.timeOfDay ?? '').trim();
  const timezone = String(data.schedule.timezone ?? '').trim();

  const daysOfWeekRaw = Array.isArray(data.schedule.daysOfWeek) ? data.schedule.daysOfWeek : [];
  const daysOfWeek = daysOfWeekRaw
    .map((d) => Number(d))
    .filter((d) => Number.isFinite(d) && d >= 1 && d <= 7);

  const dayOfMonthRaw = data.schedule.dayOfMonth;
  const dayOfMonth = Number.isFinite(Number(dayOfMonthRaw)) ? Number(dayOfMonthRaw) : undefined;

  let dateTs: admin.firestore.Timestamp | undefined;
  if (scheduleType === 'date') {
    const dateStr = String(data.schedule.date ?? '').trim();
    if (!dateStr) throw httpsError('invalid-argument', 'schedule.date requerido para tipo date.');
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) {
      throw httpsError('invalid-argument', 'schedule.date inválido.');
    }
    dateTs = admin.firestore.Timestamp.fromDate(parsed);
  }

  const schedule: PreventiveSchedule = {
    type: scheduleType as PreventiveScheduleType,
    timezone: timezone || undefined,
    timeOfDay: timeOfDay || undefined,
    daysOfWeek: daysOfWeek.length ? daysOfWeek : undefined,
    dayOfMonth: scheduleType === 'monthly' ? dayOfMonth : undefined,
    date: scheduleType === 'date' ? dateTs : undefined,
  };

  const now = admin.firestore.FieldValue.serverTimestamp();
  const orgRef = db.collection('organizations').doc(orgId);
  const templateRef = orgRef.collection('preventiveTemplates').doc(templateId);

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');

    const templateSnap = await tx.get(templateRef);
    if (!templateSnap.exists) throw httpsError('not-found', 'Plantilla no encontrada.');
    if (String(templateSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('permission-denied', 'Plantilla fuera de la organización.');
    }

    const orgData = orgSnap.data() as FirebaseFirestore.DocumentData | undefined;

    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    ensureEntitlementAllowsCreate({
      kind: 'preventives',
      entitlement,
      features,
      orgType: String(orgData?.type ?? ''),
    });

    if (siteId) {
      const siteSnap = await tx.get(orgRef.collection('sites').doc(siteId));
      if (!siteSnap.exists || String(siteSnap.get('organizationId') ?? '') !== orgId) {
        throw httpsError('failed-precondition', 'La ubicación indicada no existe en esta organización.');
      }
    }

    if (departmentId) {
      const deptSnap = await tx.get(orgRef.collection('departments').doc(departmentId));
      if (!deptSnap.exists || String(deptSnap.get('organizationId') ?? '') !== orgId) {
        throw httpsError('failed-precondition', 'El departamento indicado no existe en esta organización.');
      }
    }

    if (assetId) {
      const assetSnap = await tx.get(orgRef.collection('assets').doc(assetId));
      if (!assetSnap.exists || String(assetSnap.get('organizationId') ?? '') !== orgId) {
        throw httpsError('failed-precondition', 'El activo indicado no existe en esta organización.');
      }
    }

    const zonedNow = resolveZonedDate(schedule.timezone);
    const computed = automatic && status === 'active' ? computeNextRunAt(schedule, zonedNow) : null;

    const storedSchedule: PreventiveSchedule = stripUndefinedDeep({
      ...schedule,
      nextRunAt: computed ? admin.firestore.Timestamp.fromDate(computed) : undefined,
      lastRunAt: schedule.type === 'date' ? undefined : (templateSnap.get('schedule.lastRunAt') as any),
    });

    tx.update(
      templateRef,
      stripUndefinedDeep({
        name,
        description: description || undefined,
        status,
        automatic,
        checklist: checklist.length ? checklist : undefined,
        schedule: storedSchedule,
        priority,
        siteId: siteId || undefined,
        departmentId: departmentId || undefined,
        assetId: assetId || undefined,
        updatedBy: actorUid,
        updatedAt: now,
        source: 'updatePreventiveTemplate_v1',
      }),
    );

    // Keep pausedReason only when template remains paused.
    if (status !== 'paused') {
      tx.update(templateRef, {
        pausedReason: admin.firestore.FieldValue.delete(),
      });
    } else if (typeof (data as any).pausedReason === 'string' && String((data as any).pausedReason).trim()) {
      tx.update(templateRef, {
        pausedReason: String((data as any).pausedReason).trim(),
      });
    }
  });

  await auditLog({
    action: 'updatePreventiveTemplate',
    actorUid,
    actorEmail,
    orgId,
    after: { templateId, name, status, automatic },
  });

  return { ok: true, organizationId: orgId, templateId };
});

export const duplicatePreventiveTemplate = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);
  const templateId = requireStringField(data.templateId, 'templateId');

  const { role } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para duplicar plantillas preventivas.');

  const now = admin.firestore.FieldValue.serverTimestamp();
  const orgRef = db.collection('organizations').doc(orgId);
  const sourceRef = orgRef.collection('preventiveTemplates').doc(templateId);
  const targetRef = orgRef.collection('preventiveTemplates').doc();

  let newName = '';

  await db.runTransaction(async (tx) => {
    const [orgSnap, sourceSnap] = await Promise.all([tx.get(orgRef), tx.get(sourceRef)]);

    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    if (!sourceSnap.exists) throw httpsError('not-found', 'Plantilla no encontrada.');
    if (String(sourceSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('permission-denied', 'Plantilla fuera de la organización.');
    }

    const orgData = orgSnap.data() as FirebaseFirestore.DocumentData | undefined;
    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const isDemoOrg = isDemoOrganization(orgId, orgData);
    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    ensureEntitlementAllowsCreate({
      kind: 'preventives',
      entitlement,
      features,
      orgType: String(orgData?.type ?? ''),
    });
    await ensureDemoTemplateLimit(tx, orgRef, isDemoOrg);

    const sourceData = sourceSnap.data() as any;
    const baseName = String(sourceData?.name ?? '').trim() || 'Plantilla';
    newName = `Copia de ${baseName}`;

    const schedule = (sourceData?.schedule ?? {}) as PreventiveSchedule;
    const storedSchedule: PreventiveSchedule = {
      ...schedule,
      nextRunAt: undefined,
      lastRunAt: undefined,
    };

    tx.create(targetRef, {
      ...sourceData,
      name: newName,
      status: 'paused',
      schedule: storedSchedule,
      createdBy: actorUid,
      updatedBy: actorUid,
      createdAt: now,
      updatedAt: now,
      source: 'duplicatePreventiveTemplate_v1',
    });
  });

  await auditLog({
    action: 'duplicatePreventiveTemplate',
    actorUid,
    actorEmail,
    orgId,
    after: { templateId: targetRef.id, sourceTemplateId: templateId, name: newName },
  });

  return { ok: true, organizationId: orgId, templateId: targetRef.id };
});

export const deletePreventiveTemplate = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);
  const templateId = requireStringField(data.templateId, 'templateId');

  const { role } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para eliminar plantillas preventivas.');

  const orgRef = db.collection('organizations').doc(orgId);
  const templateRef = orgRef.collection('preventiveTemplates').doc(templateId);
  const openWorkOrdersQuery = orgRef
    .collection('workOrders')
    .where('kind', '==', 'preventive')
    .where('isOpen', '==', true)
    .where('preventiveTemplateId', '==', templateId)
    .limit(1);

  await db.runTransaction(async (tx) => {
    const [orgSnap, templateSnap, openWosSnap] = await Promise.all([
      tx.get(orgRef),
      tx.get(templateRef),
      tx.get(openWorkOrdersQuery),
    ]);

    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    if (!templateSnap.exists) throw httpsError('not-found', 'Plantilla no encontrada.');
    if (String(templateSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('permission-denied', 'Plantilla fuera de la organización.');
    }

    if (!openWosSnap.empty) {
      throw httpsError(
        'failed-precondition',
        'No se puede eliminar: existen OTs preventivas abiertas asociadas a esta plantilla.',
      );
    }

    tx.delete(templateRef);
  });

  await auditLog({
    action: 'deletePreventiveTemplate',
    actorUid,
    actorEmail,
    orgId,
    after: { templateId },
  });

  return { ok: true, organizationId: orgId, templateId };
});

export const generatePreventiveNow = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const orgId = resolveOrgIdFromData(data);
  const templateId = requireStringField(data.templateId, 'templateId');

  const { role } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para generar preventivos manualmente.');

  const orgRef = db.collection('organizations').doc(orgId);
  const templateRef = orgRef.collection('preventiveTemplates').doc(templateId);

  const nowServer = admin.firestore.FieldValue.serverTimestamp();
  const nowMillis = Date.now();
  const ticketId = `prev_${templateId}_${nowMillis}`;
  const ticketRef = orgRef.collection('tickets').doc(ticketId);

  await db.runTransaction(async (tx) => {
    const [orgSnap, templateSnap, existingTicket] = await Promise.all([
      tx.get(orgRef),
      tx.get(templateRef),
      tx.get(ticketRef),
    ]);

    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    if (!templateSnap.exists) throw httpsError('not-found', 'Plantilla no encontrada.');
    if (String(templateSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('permission-denied', 'Plantilla fuera de la organización.');
    }
    if (existingTicket.exists) {
      throw httpsError('already-exists', 'La orden ya existe.');
    }

    const orgData = orgSnap.data() as any;
    if (orgData?.preventivesPausedByEntitlement === true) {
      throw httpsError('failed-precondition', 'Los preventivos están pausados por el plan actual.');
    }

    const entitlement = orgData?.entitlement as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    if (!isFeatureEnabled({ ...(entitlement as any), features }, 'PREVENTIVES')) {
      throw httpsError('failed-precondition', 'Tu plan actual no incluye preventivos.');
    }

    const template = templateSnap.data() as PreventiveTemplate;
    if (template.status !== 'active') {
      throw httpsError('failed-precondition', 'La plantilla no está activa.');
    }
    if (!template.siteId || !template.departmentId) {
      throw httpsError('failed-precondition', 'La plantilla necesita siteId y departmentId para generar una orden.');
    }

    const schedule = template.schedule;
    if (!schedule?.type) throw httpsError('failed-precondition', 'La plantilla no tiene programación válida.');

    const runAtDate = resolveZonedDate(schedule.timezone);
    const runAtTimestamp = admin.firestore.Timestamp.fromDate(runAtDate);

    const nextBase = new Date(runAtDate.getTime() + 60 * 1000);
    const followingRunDate = schedule.type === 'date' ? null : computeNextRunAt(schedule, nextBase);
    const frequencyDays = resolveFrequencyDays(schedule);

    ensureEntitlementAllowsCreate({ kind: 'preventives', entitlement, features });

    const ticketPayload = {
      organizationId: orgId,
      type: 'preventivo',
      status: 'new',
      priority: template.priority ?? 'Media',
      siteId: template.siteId,
      departmentId: template.departmentId,
      assetId: template.assetId ?? null,
      title: template.name,
      description: template.description ?? '',
      createdBy: actorUid,
      assignedRole: 'mantenimiento',
      assignedTo: null,
      createdAt: nowServer,
      updatedAt: nowServer,
      preventiveTemplateId: templateRef.id,
      templateSnapshot: {
        name: template.name,
        frequencyDays,
      },
      preventive: {
        frequencyDays,
        scheduledFor: runAtTimestamp,
        checklist: template.checklist ?? [],
      },
      source: 'generatePreventiveNow_v1',
    };

    tx.create(ticketRef, ticketPayload);
    tx.update(orgRef, {
      [`entitlement.usage.${USAGE_FIELDS.preventives}`]: admin.firestore.FieldValue.increment(1),
      'entitlement.updatedAt': nowServer,
    });

    tx.update(templateRef, {
      'schedule.lastRunAt': runAtTimestamp,
      'schedule.nextRunAt': followingRunDate ? admin.firestore.Timestamp.fromDate(followingRunDate) : null,
      updatedAt: nowServer,
    });
  });

  await auditLog({
    action: 'generatePreventiveNow',
    actorUid,
    actorEmail,
    orgId,
    after: { templateId, ticketId },
  });

  return { ok: true, organizationId: orgId, templateId, ticketId };
});

// --- Work Orders (Preventivos como OT) ---
type WorkOrderStatus = 'open' | 'closed';
type WorkOrderKind = 'preventive';

type WorkOrderChecklistItem = {
  label: string;
  required: boolean;
  order: number;
};

function normalizeChecklistItems(raw: unknown[] | undefined | null): WorkOrderChecklistItem[] {
  const items: WorkOrderChecklistItem[] = [];
  const arr = Array.isArray(raw) ? raw : [];
  let order = 0;
  for (const it of arr) {
    order += 1;
    if (typeof it === 'string') {
      const label = it.trim();
      if (!label) continue;
      items.push({ label, required: true, order });
      continue;
    }
    if (it && typeof it === 'object') {
      const anyIt = it as any;
      const label = String(anyIt.label ?? anyIt.text ?? anyIt.name ?? '').trim();
      if (!label) continue;
      const required = Boolean(anyIt.required ?? true);
      items.push({ label, required, order: Number(anyIt.order ?? order) });
      continue;
    }
  }
  return items;
}

export const workOrders_generateNow = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = resolveOrgIdFromData(data);
  const templateId = requireStringField(data.templateId, 'templateId');

  const { role } = await requireActiveMembership(actorUid, orgId);
  requireRoleAllowed(role, MASTER_DATA_ROLES, 'No tienes permisos para generar OTs de preventivo manualmente.');

  const orgRef = db.collection('organizations').doc(orgId);
  const templateRef = orgRef.collection('preventiveTemplates').doc(templateId);

  const nowServer = admin.firestore.FieldValue.serverTimestamp();
  const nowMillis = Date.now();
  const woId = `wo_prev_${templateId}_${nowMillis}`;
  const woRef = orgRef.collection('workOrders').doc(woId);

  await db.runTransaction(async (tx) => {
    const [orgSnap, templateSnap, existingWo] = await Promise.all([
      tx.get(orgRef),
      tx.get(templateRef),
      tx.get(woRef),
    ]);

    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    if (!templateSnap.exists) throw httpsError('not-found', 'Plantilla no encontrada.');
    if (String(templateSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('permission-denied', 'Plantilla fuera de la organización.');
    }
    if (existingWo.exists) {
      throw httpsError('already-exists', 'La OT ya existe.');
    }

    const orgData = orgSnap.data() as any;
    if (orgData?.preventivesPausedByEntitlement === true) {
      throw httpsError('failed-precondition', 'Los preventivos están pausados por el plan actual.');
    }

    const entitlement = orgData?.entitlement as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    if (!isFeatureEnabled({ ...(entitlement as any), features }, 'PREVENTIVES')) {
      throw httpsError('failed-precondition', 'Tu plan actual no incluye preventivos.');
    }

    const template = templateSnap.data() as PreventiveTemplate;
    if (template.status !== 'active') {
      throw httpsError('failed-precondition', 'La plantilla no está activa.');
    }
    if (!template.siteId || !template.departmentId) {
      throw httpsError('failed-precondition', 'La plantilla necesita siteId y departmentId para generar una OT.');
    }

    const schedule = template.schedule;
    if (!schedule?.type) throw httpsError('failed-precondition', 'La plantilla no tiene programación válida.');

    const runAtDate = resolveZonedDate(schedule.timezone);
    const runAtTimestamp = admin.firestore.Timestamp.fromDate(runAtDate);

    const nextBase = new Date(runAtDate.getTime() + 60 * 1000);
    const followingRunDate = schedule.type === 'date' ? null : computeNextRunAt(schedule, nextBase);
    const frequencyDays = resolveFrequencyDays(schedule);

    ensureEntitlementAllowsCreate({ kind: 'preventives', entitlement, features });

    const checklistItems = normalizeChecklistItems(template.checklist as any);
    const checklistRequired = checklistItems.length > 0;

    const woPayload = {
      organizationId: orgId,
      kind: 'preventive' as WorkOrderKind,
      status: 'open' as WorkOrderStatus,
      isOpen: true,
      priority: template.priority ?? 'Media',
      siteId: template.siteId,
      departmentId: template.departmentId,
      assetId: template.assetId ?? null,
      title: template.name,
      description: template.description ?? '',
      createdBy: actorUid,
      assignedTo: null,
      createdAt: nowServer,
      updatedAt: nowServer,
      preventiveTemplateId: templateRef.id,
      templateSnapshot: {
        name: template.name,
        frequencyDays,
      },
      preventive: {
        frequencyDays,
        scheduledFor: runAtTimestamp,
      },
      checklistRequired,
      source: 'workOrders_generateNow_v1',
    };

    tx.create(woRef, woPayload);

    // Crear checklist en subcolección (server-only)
    if (checklistItems.length) {
      for (const item of checklistItems) {
        const itemRef = woRef.collection('checklistItems').doc();
        tx.create(itemRef, {
          organizationId: orgId,
          label: item.label,
          required: item.required,
          order: item.order,
          done: false,
          doneAt: null,
          doneBy: null,
          createdAt: nowServer,
          updatedAt: nowServer,
        });
      }
    }

    tx.update(orgRef, {
      [`entitlement.usage.${USAGE_FIELDS.preventives}`]: admin.firestore.FieldValue.increment(1),
      'entitlement.updatedAt': nowServer,
    });

    tx.update(templateRef, {
      'schedule.lastRunAt': runAtTimestamp,
      'schedule.nextRunAt': followingRunDate ? admin.firestore.Timestamp.fromDate(followingRunDate) : null,
      updatedAt: nowServer,
    });
  });

  await auditLog({
    action: 'workOrders_generateNow',
    actorUid,
    actorEmail,
    orgId,
    after: { templateId, woId },
  });

  return { ok: true, organizationId: orgId, templateId, woId };
});

export const workOrders_start = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = resolveOrgIdFromData(data);
  const woId = requireStringField(data.woId, 'woId');

  const { role } = await requireActiveMembership(actorUid, orgId);

  const orgRef = db.collection('organizations').doc(orgId);
  const woRef = orgRef.collection('workOrders').doc(woId);

  const woSnap = await woRef.get();
  if (!woSnap.exists) throw httpsError('not-found', 'OT no encontrada.');
  if (String(woSnap.get('organizationId') ?? '') !== orgId) {
    throw httpsError('permission-denied', 'OT fuera de la organización.');
  }

  const wo = woSnap.data() as any;
  const createdBy = String(wo?.createdBy ?? '');
  const assignedTo = String(wo?.assignedTo ?? '');
  const isAdminLike = ADMIN_LIKE_ROLES.has(role);
  const isActorRelated = actorUid === createdBy || (assignedTo && actorUid === assignedTo);

  if (!isAdminLike && !isActorRelated) {
    throw httpsError('permission-denied', 'Solo el creador/asignado o admin/mantenimiento puede iniciar esta OT.');
  }

  if (wo?.isOpen !== true) {
    throw httpsError('failed-precondition', 'La OT está cerrada.');
  }

  const currentStatus = String(wo?.status ?? 'open');
  if (currentStatus === 'in_progress') {
    return { ok: true, organizationId: orgId, woId, status: 'in_progress' };
  }

  const nowServer = admin.firestore.FieldValue.serverTimestamp();
  await woRef.update({
    status: 'in_progress',
    startedAt: nowServer,
    startedBy: actorUid,
    updatedAt: nowServer,
  });

  await auditLog({
    action: 'workOrders_start',
    actorUid,
    actorEmail,
    orgId,
    after: { woId },
  });

  return { ok: true, organizationId: orgId, woId, status: 'in_progress' };
});

export const workOrders_close = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = resolveOrgIdFromData(data);
  const woId = requireStringField(data.woId, 'woId');

  const { role } = await requireActiveMembership(actorUid, orgId);

  const orgRef = db.collection('organizations').doc(orgId);
  const woRef = orgRef.collection('workOrders').doc(woId);

  const woSnap = await woRef.get();
  if (!woSnap.exists) throw httpsError('not-found', 'OT no encontrada.');
  if (String(woSnap.get('organizationId') ?? '') !== orgId) {
    throw httpsError('permission-denied', 'OT fuera de la organización.');
  }

  const wo = woSnap.data() as any;
  const createdBy = String(wo?.createdBy ?? '');
  const assignedTo = String(wo?.assignedTo ?? '');
  const isAdminLike = ADMIN_LIKE_ROLES.has(role);
  const isActorRelated = actorUid === createdBy || (assignedTo && actorUid === assignedTo);

  if (!isAdminLike && !isActorRelated) {
    throw httpsError('permission-denied', 'Solo el creador/asignado o admin/mantenimiento puede cerrar esta OT.');
  }

  if (wo?.isOpen !== true) {
    throw httpsError('failed-precondition', 'La OT ya está cerrada.');
  }

  const checklistRequired = Boolean(wo?.checklistRequired === true);
  if (checklistRequired) {
    const incomplete = await woRef
      .collection('checklistItems')
      .where('required', '==', true)
      .where('done', '==', false)
      .limit(1)
      .get();

    if (!incomplete.empty) {
      throw httpsError('failed-precondition', 'No se puede cerrar: hay items obligatorios sin completar.');
    }
  }

  const nowServer = admin.firestore.FieldValue.serverTimestamp();
  await woRef.update({
    status: 'closed',
    isOpen: false,
    closedAt: nowServer,
    closedBy: actorUid,
    updatedAt: nowServer,
  });

  await auditLog({
    action: 'workOrders_close',
    actorUid,
    actorEmail,
    orgId,
    after: { woId },
  });

  return { ok: true, organizationId: orgId, woId };
});

export const workOrders_addReport = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  try {
    const orgId = resolveOrgIdFromData(data);
    const woId = requireStringField(data?.woId, 'woId');
    const descriptionRaw = String(data?.description ?? data?.text ?? data?.reportAppend?.description ?? data?.payload?.description ?? '').trim();

    if (!descriptionRaw) {
      throw httpsError('invalid-argument', 'El informe no puede estar vacío.');
    }
    if (descriptionRaw.length > 5000) {
      throw httpsError('invalid-argument', 'El informe es demasiado largo (máx 5000 caracteres).');
    }

    const { role } = await requireActiveMembership(actorUid, orgId);

    const orgRef = db.collection('organizations').doc(orgId);
    const woRef = orgRef.collection('workOrders').doc(woId);

    const woSnap = await woRef.get();
    if (!woSnap.exists) throw httpsError('not-found', 'OT no encontrada.');
    if (String(woSnap.get('organizationId') ?? '') !== orgId) {
      throw httpsError('permission-denied', 'OT fuera de la organización.');
    }

    const wo = woSnap.data() as any;
    const createdBy = String(wo?.createdBy ?? '');
    const assignedTo = String(wo?.assignedTo ?? '');
    const isAdminLike = ADMIN_LIKE_ROLES.has(role);
    const isActorRelated = actorUid === createdBy || (assignedTo && actorUid === assignedTo);

    if (!isAdminLike && !isActorRelated) {
      throw httpsError('permission-denied', 'Solo el creador/asignado o admin/mantenimiento puede registrar informes en esta OT.');
    }

    if (wo?.isOpen !== true) {
      throw httpsError('failed-precondition', 'La OT está cerrada. No se pueden añadir informes.');
    }

    const entry = {
      description: descriptionRaw,
      createdAt: admin.firestore.Timestamp.now(),
      createdBy: actorUid,
    };

    const nowServer = admin.firestore.FieldValue.serverTimestamp();
    await woRef.update({
      reports: admin.firestore.FieldValue.arrayUnion(entry),
      updatedAt: nowServer,
    });

    await auditLog({
      action: 'workOrders_addReport',
      actorUid,
      actorEmail,
      orgId,
      after: { woId },
    });

    return { ok: true, organizationId: orgId, woId };
  } catch (error: any) {
    functions.logger.error('workOrders_addReport failed', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });

    // Preserve explicit HttpsError codes so the client can show meaningful feedback.
    if (error instanceof functions.https.HttpsError || error?.constructor?.name === 'HttpsError') {
      throw error;
    }

    // Fallback: unknown/internal.
    throw new functions.https.HttpsError('internal', 'Error interno registrando el informe.', {
      reason: 'workOrders_addReport_failed',
    });
  }
});

// Back-compat: generatePreventiveNow sigue existiendo, pero se recomienda migrar a workOrders_generateNow.

export const inviteUserToOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = resolveOrgIdFromData(data);
  const email = requireStringField(data?.email, 'email').toLowerCase();
  const displayName = String(data?.displayName ?? '').trim();
  const requestedRole: Role = normalizeRole(data?.role) ?? 'operario';
  const departmentId = String(data?.departmentId ?? '').trim();

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  let targetUid = '';
  try {
    const authUser = await admin.auth().getUserByEmail(email);
    targetUid = authUser.uid;
  } catch {
    targetUid = '';
  }

  const inviteId = targetUid || `invite_${email}`;
  const orgRef = db.collection('organizations').doc(orgId);
  const joinReqRef = orgRef.collection('joinRequests').doc(inviteId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  let alreadyPending = false;
  let orgName = orgId;

  await db.runTransaction(async (tx) => {
    const orgSnap = await tx.get(orgRef);
    if (!orgSnap.exists) throw httpsError('not-found', 'Organización no encontrada.');
    orgName = String((orgSnap.data() as any)?.name ?? orgId);

    const entitlement = orgSnap.get('entitlement') as Entitlement | undefined;
    if (!entitlement) throw httpsError('failed-precondition', 'La organización no tiene entitlement.');

    const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
    ensureEntitlementAllowsCreate({ kind: 'users', entitlement, features });

    if (targetUid) {
      const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
      const membershipSnap = await tx.get(membershipRef);
      if (membershipSnap.exists) {
        const status =
          String(membershipSnap.get('status') ?? '') ||
          (membershipSnap.get('active') === true ? 'active' : 'pending');
        if (status === 'active') {
          throw httpsError('failed-precondition', 'El usuario ya pertenece a la organización.');
        }
      }
    }

    const existingJoinReq = await tx.get(joinReqRef);
    if (existingJoinReq.exists && String(existingJoinReq.get('status') ?? '') === 'pending') {
      alreadyPending = true;
      return;
    }

    tx.set(
      joinReqRef,
      {
        userId: targetUid || null,
        organizationId: orgId,
        organizationName: orgName,
        email,
        displayName: displayName || email,
        requestedRole,
        status: 'pending',
        departmentId: departmentId || null,
        invitedBy: actorUid,
        invitedByEmail: actorEmail,
        invitedAt: now,
        createdAt: now,
        updatedAt: now,
        source: 'inviteUserToOrg_v1',
      },
      { merge: true },
    );

    tx.update(orgRef, {
      [`entitlement.usage.${USAGE_FIELDS.users}`]: admin.firestore.FieldValue.increment(1),
      'entitlement.updatedAt': now,
    });
  });

  if (!alreadyPending) {
    try {
      await sendInviteEmail({
        recipientEmail: email,
        orgName,
        role: requestedRole,
        inviteLink: 'https://multi.maintelligence.app/login',
      });
    } catch (error) {
      console.warn('Error enviando email de invitación.', error);
    }
  }

  await auditLog({
    action: 'inviteUserToOrg',
    actorUid,
    actorEmail,
    orgId,
    targetUid: targetUid || null,
    targetEmail: email,
    after: { status: 'pending', role: requestedRole, requestId: inviteId },
  });

  return { ok: true, organizationId: orgId, uid: targetUid || null, requestId: inviteId, alreadyPending };
});

export const pauseExpiredDemoPreventives = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('UTC')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const orgsSnap = await db
      .collection('organizations')
      .where('demoExpiresAt', '<=', now)
      .get();

    if (orgsSnap.empty) return null;

    for (const orgDoc of orgsSnap.docs) {
      await pausePreventiveTicketsForOrg(orgDoc.id, now);
    }

    return null;
  });

export const pausePreventivesWithoutEntitlement = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('UTC')
  .onRun(async () => {
    const planCatalogSnap = await db.collection('planCatalog').get();
    if (planCatalogSnap.empty) return null;

    const blockedPlanIds = planCatalogSnap.docs
      .filter((planDoc) => {
        const features = planDoc.get('features') as Record<string, boolean> | undefined;
        return features?.PREVENTIVES !== true;
      })
      .map((planDoc) => planDoc.id);

    if (blockedPlanIds.length === 0) return null;

    const now = admin.firestore.Timestamp.now();

    for (let i = 0; i < blockedPlanIds.length; i += 10) {
      const chunk = blockedPlanIds.slice(i, i + 10);
      const orgsSnap = await db
        .collection('organizations')
        .where('entitlement.planId', 'in', chunk)
        .get();

      if (orgsSnap.empty) continue;

      for (const orgDoc of orgsSnap.docs) {
        await pausePreventiveTicketsForOrg(orgDoc.id, now);
      }
    }

    return null;
  });

export const generatePreventiveTickets = functions.pubsub
  .schedule('every 60 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const templatesSnap = await db
      .collectionGroup('preventiveTemplates')
      .where('status', '==', 'active')
      .where('automatic', '==', true)
      .get();

    if (templatesSnap.empty) return null;

    for (const templateDoc of templatesSnap.docs) {
      const template = templateDoc.data() as PreventiveTemplate;
      const orgId = resolveTemplateOrgId(templateDoc.ref, template);
      if (!orgId) continue;

      const templateRef = templateDoc.ref;

      if (!template.schedule?.type) continue;
      if (!template.siteId || !template.departmentId) {
        await templateRef.update({
          status: 'paused',
          pausedReason: 'missing_site_or_department',
          'schedule.nextRunAt': null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }

      const orgRef = db.collection('organizations').doc(orgId);

      let createdTicketId: string | null = null;

      await db.runTransaction(async (tx) => {
        const [orgSnap, templateSnap] = await Promise.all([tx.get(orgRef), tx.get(templateRef)]);
        if (!orgSnap.exists || !templateSnap.exists) return;

        const orgData = orgSnap.data() as any;
        if (orgData?.preventivesPausedByEntitlement === true) return;

        const entitlement = orgData?.entitlement as Entitlement | undefined;
        if (!entitlement) return;

        const features = await resolvePlanFeaturesForTx(tx, entitlement.planId);
        if (!isFeatureEnabled({ ...(entitlement as any), features }, 'PREVENTIVES')) return;

        const freshTemplate = templateSnap.data() as PreventiveTemplate;
        if (!freshTemplate.automatic || freshTemplate.status !== 'active') return;
        if (!freshTemplate.siteId || !freshTemplate.departmentId) return;

        const schedule = freshTemplate.schedule;
        if (!schedule?.type) return;
        if (schedule.type === 'date' && schedule.lastRunAt) return;

        const nowZoned = resolveZonedDate(schedule.timezone);
        const nextRunDate =
          schedule.nextRunAt?.toDate() ?? computeNextRunAt(schedule, nowZoned);

        if (!nextRunDate) {
          tx.update(templateRef, {
            'schedule.nextRunAt': null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }

        if (nextRunDate > nowZoned) {
          if (!schedule.nextRunAt) {
            tx.update(templateRef, {
              'schedule.nextRunAt': admin.firestore.Timestamp.fromDate(nextRunDate),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
          return;
        }

        const runAtTimestamp = admin.firestore.Timestamp.fromDate(nextRunDate);
        const ticketId = `prev_${templateRef.id}_${runAtTimestamp.toMillis()}`;
        const ticketRef = orgRef.collection('tickets').doc(ticketId);
        const existingTicket = await tx.get(ticketRef);

        const nextBase = new Date(nextRunDate.getTime() + 60 * 1000);
        const followingRunDate =
          schedule.type === 'date' ? null : computeNextRunAt(schedule, nextBase);

        const frequencyDays = resolveFrequencyDays(schedule);

        if (!existingTicket.exists) {
          const now = admin.firestore.FieldValue.serverTimestamp();
          const ticketPayload = {
            organizationId: orgId,
            type: 'preventivo',
            status: 'new',
            priority: freshTemplate.priority ?? 'Media',
            siteId: freshTemplate.siteId,
            departmentId: freshTemplate.departmentId,
            assetId: freshTemplate.assetId ?? null,
            title: freshTemplate.name,
            description: freshTemplate.description ?? '',
            createdBy: freshTemplate.createdBy ?? 'system',
            assignedRole: 'mantenimiento',
            assignedTo: null,
            createdAt: now,
            updatedAt: now,
            preventiveTemplateId: templateRef.id,
            templateSnapshot: {
              name: freshTemplate.name,
              frequencyDays,
            },
            preventive: {
              frequencyDays,
              scheduledFor: runAtTimestamp,
              checklist: freshTemplate.checklist ?? [],
            },
            source: 'generatePreventiveTickets_v1',
          };

          tx.create(ticketRef, ticketPayload);
          ensureEntitlementAllowsCreate({ kind: 'preventives', entitlement, features });
          tx.update(orgRef, {
            [`entitlement.usage.${USAGE_FIELDS.preventives}`]: admin.firestore.FieldValue.increment(1),
            'entitlement.updatedAt': now,
          });
          createdTicketId = ticketRef.id;
        }

        tx.update(templateRef, {
          'schedule.lastRunAt': runAtTimestamp,
          'schedule.nextRunAt': followingRunDate
            ? admin.firestore.Timestamp.fromDate(followingRunDate)
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      if (createdTicketId) {
        await auditLog({
          action: 'generatePreventiveTicket',
          actorUid: 'system',
          orgId,
          after: {
            templateId: templateDoc.id,
            ticketId: createdTicketId,
          },
        });
      }
    }

    return null;
  });

export const orgInviteUser = functions.https.onRequest(async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const decoded = await requireAuthFromRequest(req);
    const actorUid = decoded.uid;
    const actorEmail = (decoded.email ?? null) as string | null;

    const orgId = sanitizeOrganizationId(String(req.body?.organizationId ?? ''));
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const displayName = String(req.body?.displayName ?? '').trim();
    const requestedRole: Role = normalizeRole(req.body?.role) ?? 'operario';
    const departmentId = String(req.body?.departmentId ?? '').trim();

    if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
    if (!email) throw httpsError('invalid-argument', 'email requerido.');

    await requireCallerSuperAdminInOrg(actorUid, orgId);

    const orgRef = db.collection('organizations').doc(orgId);
    const orgSnap = await orgRef.get();
    const orgName = String((orgSnap.data() as any)?.name ?? orgId);

    let targetUid = '';
    try {
      const authUser = await admin.auth().getUserByEmail(email);
      targetUid = authUser.uid;
    } catch {
      targetUid = '';
    }

    if (targetUid) {
      const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);
      const membershipSnap = await membershipRef.get();
      if (membershipSnap.exists) {
        const status =
          String(membershipSnap.get('status') ?? '') ||
          (membershipSnap.get('active') === true ? 'active' : 'pending');
        if (status === 'active') {
          throw httpsError('failed-precondition', 'El usuario ya pertenece a la organización.');
        }
      }
    }

    const inviteId = targetUid || `invite_${email}`;
    const joinReqRef = orgRef.collection('joinRequests').doc(inviteId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await joinReqRef.set(
      {
        userId: targetUid || null,
        organizationId: orgId,
        organizationName: orgName,
        email,
        displayName: displayName || email,
        requestedRole,
        status: 'pending',
        departmentId: departmentId || null,
        invitedBy: actorUid,
        invitedByEmail: actorEmail,
        invitedAt: now,
        createdAt: now,
        updatedAt: now,
        source: 'orgInviteUser_v1',
      },
      { merge: true }
    );

    try {
      await sendInviteEmail({
        recipientEmail: email,
        orgName,
        role: requestedRole,
        inviteLink: 'https://multi.maintelligence.app/login',
      });
    } catch (error) {
      console.warn('Error enviando email de invitación.', error);
    }

    await auditLog({
      action: 'orgInviteUser',
      actorUid,
      actorEmail,
      orgId,
      targetUid: targetUid || null,
      targetEmail: email,
      after: { status: 'pending', role: requestedRole },
    });

    res.status(200).json({ ok: true, organizationId: orgId, uid: targetUid || null, requestId: inviteId });
  } catch (err) {
    sendHttpError(res, err);
  }
});

export const orgUpdateUserProfile = functions.https.onRequest(async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const decoded = await requireAuthFromRequest(req);
    const actorUid = decoded.uid;
    const actorEmail = (decoded.email ?? null) as string | null;
    const isRoot = Boolean((decoded as any)?.root === true || (decoded as any)?.role === 'root');

    const orgId = sanitizeOrganizationId(String(req.body?.organizationId ?? ''));
    const targetUid = String(req.body?.uid ?? '').trim();
    const displayName = String(req.body?.displayName ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const departmentId = String(req.body?.departmentId ?? '').trim();
    const locationId = String(req.body?.locationId ?? '').trim();
    await updateOrganizationUserProfile({
      actorUid,
      actorEmail,
      isRoot,
      orgId,
      targetUid,
      displayName,
      email,
      departmentId,
      locationId,
    });

    res.status(200).json({ ok: true, organizationId: orgId, uid: targetUid });
  } catch (err) {
    sendHttpError(res, err);
  }
});

export const orgUpdateUserProfileCallable = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;
  const isRoot = isRootClaim(context);

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  const targetUid = String(data?.uid ?? '').trim();
  const displayName = String(data?.displayName ?? '').trim();
  const email = String(data?.email ?? '').trim().toLowerCase();
  const departmentId = String(data?.departmentId ?? '').trim();
  const locationId = String(data?.locationId ?? '').trim();
  await updateOrganizationUserProfile({
    actorUid,
    actorEmail,
    isRoot,
    orgId,
    targetUid,
    displayName,
    email,
    departmentId,
    locationId,
  });

  return { ok: true, organizationId: orgId, uid: targetUid };
});

export const orgApproveJoinRequest = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  const requestId = String(data?.uid ?? data?.requestId ?? '').trim();
  const role: Role = normalizeRole(data?.role) ?? 'operario';

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!requestId) throw httpsError('invalid-argument', 'uid requerido.');

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  const orgRef = db.collection('organizations').doc(orgId);
  const joinReqRef = orgRef.collection('joinRequests').doc(requestId);
  const joinReqSnap = await joinReqRef.get();

  if (!joinReqSnap.exists) throw httpsError('not-found', 'No existe la solicitud.');
  const jr = joinReqSnap.data() as any;
  if (String(jr?.status ?? '') !== 'pending') {
    throw httpsError('failed-precondition', 'La solicitud no está pendiente.');
  }

  let targetUid = String(jr?.userId ?? '').trim();
  if (!targetUid && jr?.email) {
    try {
      targetUid = await resolveTargetUidByEmailOrUid(jr.email);
    } catch (err: any) {
      throw httpsError('failed-precondition', 'El usuario invitado aún no está registrado.');
    }
  }

  if (!targetUid) throw httpsError('failed-precondition', 'No se pudo resolver el usuario objetivo.');

  const orgSnap = await orgRef.get();
  const orgName = String((orgSnap.data() as any)?.name ?? orgId);

  const userRef = db.collection('users').doc(targetUid);
  const memberRef = orgRef.collection('members').doc(targetUid);
  void memberRef;
  const membershipRef = db.collection('memberships').doc(`${targetUid}_${orgId}`);

  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();

  batch.set(
    joinReqRef,
    {
      status: 'approved',
      approvedAt: now,
      approvedBy: actorUid,
      updatedAt: now,
      source: 'orgApproveJoinRequest_v1',
    },
    { merge: true },
  );

  batch.set(
    membershipRef,
    {
      userId: targetUid,
      organizationId: orgId,
      role,
      status: 'active',
      organizationName: orgName,
      updatedAt: now,
      source: 'orgApproveJoinRequest_v1',
    },
    { merge: true },
  );

  batch.set(
    memberRef,
    {
      uid: targetUid,
      orgId,
      email: String(jr?.email ?? null),
      displayName: String(jr?.displayName ?? null),
      role,
      active: true,
      updatedAt: now,
      createdAt: jr?.createdAt ?? now,
      source: 'orgApproveJoinRequest_v1',
    },
    { merge: true },
  );

  batch.set(
    userRef,
    {
      organizationId: orgId,
      role,
      active: true,
      updatedAt: now,
      source: 'orgApproveJoinRequest_v1',
      ...(jr?.departmentId !== undefined ? { departmentId: jr.departmentId || null } : {}),
    },
    { merge: true },
  );

  await batch.commit();

  await auditLog({
    action: 'orgApproveJoinRequest',
    actorUid,
    actorEmail,
    orgId,
    targetUid,
    targetEmail: String(jr?.email ?? null),
    before: { status: 'pending', role: String(jr?.requestedRole ?? null) },
    after: { status: 'active', role },
  });

  return { ok: true, organizationId: orgId, uid: targetUid, role };
});

export const orgRejectJoinRequest = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = sanitizeOrganizationId(String(data?.organizationId ?? ''));
  const requestId = String(data?.uid ?? data?.requestId ?? '').trim();
  const reason = String(data?.reason ?? '').trim().slice(0, 2000);

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!requestId) throw httpsError('invalid-argument', 'uid requerido.');

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  const orgRef = db.collection('organizations').doc(orgId);
  const joinReqRef = orgRef.collection('joinRequests').doc(requestId);
  const joinReqSnap = await joinReqRef.get();
  if (!joinReqSnap.exists) throw httpsError('not-found', 'No existe la solicitud.');

  const jr = joinReqSnap.data() as any;

  let targetUid = String(jr?.userId ?? '').trim();
  if (!targetUid && jr?.email) {
    try {
      targetUid = await resolveTargetUidByEmailOrUid(jr.email);
    } catch {
      targetUid = '';
    }
  }

  const membershipRef = targetUid ? db.collection('memberships').doc(`${targetUid}_${orgId}`) : null;
  const userRef = targetUid ? db.collection('users').doc(targetUid) : null;
  const userSnap = userRef ? await userRef.get() : null;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();

  batch.set(
    joinReqRef,
    {
      status: 'rejected',
      rejectedAt: now,
      rejectedBy: actorUid,
      rejectReason: reason || null,
      updatedAt: now,
      source: 'orgRejectJoinRequest_v1',
    },
    { merge: true },
  );

  if (membershipRef) {
    batch.set(
      membershipRef,
      {
        status: 'revoked',
        updatedAt: now,
        source: 'orgRejectJoinRequest_v1',
      },
      { merge: true },
    );
  }

  if (userRef && userSnap?.exists) {
    const userOrgId = String((userSnap.data() as any)?.organizationId ?? '');
    if (userOrgId === orgId) {
      batch.set(
        userRef,
        {
          organizationId: null,
          role: 'pending',
          active: false,
          updatedAt: now,
          source: 'orgRejectJoinRequest_v1',
        },
        { merge: true },
      );
    }
  }

  await batch.commit();

  await auditLog({
    action: 'orgRejectJoinRequest',
    actorUid,
    actorEmail,
    orgId,
    targetUid: targetUid || null,
    targetEmail: String(jr?.email ?? null),
    before: { status: String(jr?.status ?? 'pending') },
    after: { status: 'rejected', reason: reason || null },
  });

  return { ok: true, organizationId: orgId, uid: targetUid || null };
});

export const setRoleWithinOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const isRoot = isRootClaim(context);

  const targetUid = await resolveTargetUidByEmailOrUid(data?.email, data?.uid);
  const role: Role = normalizeRole(data?.role);

  return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role });
});

export const promoteToSuperAdminWithinOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const isRoot = isRootClaim(context);
  const targetUid = await resolveTargetUidByEmailOrUid(data?.email, data?.uid);

  return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role: 'super_admin' });
});

export const demoteToAdminWithinOrg = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');

  const isRoot = isRootClaim(context);
  const targetUid = await resolveTargetUidByEmailOrUid(data?.email, data?.uid);

  return setRoleWithinOrgImpl({ actorUid, actorEmail, isRoot, orgId, targetUid, role: 'admin' });
});

export const registerGooglePlayPurchase = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  const purchaseToken = String(data?.purchaseToken ?? '').trim();
  const subscriptionId = String(data?.subscriptionId ?? '').trim();
  const planIdRaw = String(data?.planId ?? '').trim();
  const packageNameRaw = String(data?.packageName ?? '').trim();

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!purchaseToken) throw httpsError('invalid-argument', 'purchaseToken requerido.');
  if (!subscriptionId) throw httpsError('invalid-argument', 'subscriptionId requerido.');

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  const googleCfg = resolveGooglePlayConfig();
  const configPackageName = googleCfg?.packageName ?? ''; 
  const packageName = packageNameRaw || configPackageName;
  if (!packageName) throw httpsError('invalid-argument', 'packageName requerido.');

  const resolvedPlanId = resolveEntitlementPlanId({
    metadataPlanId: planIdRaw || null,
  });

  const purchaseRef = db.collection('googlePlayPurchases').doc(purchaseToken);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(purchaseRef);

    const payload: Record<string, unknown> = {
      organizationId: orgId,
      subscriptionId,
      packageName,
      planId: resolvedPlanId,
      updatedAt: now,
      linkedBy: actorUid,
      source: 'registerGooglePlayPurchase_v1',
    };
    if (!snap.exists) {
      payload.createdAt = now;
    }
    tx.set(purchaseRef, payload, { merge: true });
  });

  await auditLog({
    action: 'registerGooglePlayPurchase',
    actorUid,
    actorEmail,
    orgId,
    meta: { purchaseToken, subscriptionId, packageName, planId: resolvedPlanId },
  });

  return { ok: true, organizationId: orgId, purchaseToken };
});

export const registerAppleAppAccountToken = functions.https.onCall(async (data, context) => {
  const actorUid = requireAuth(context);
  const actorEmail = ((context.auth?.token as any)?.email ?? null) as string | null;

  const orgId = String(data?.organizationId ?? '').trim();
  const appAccountToken = String(data?.appAccountToken ?? '').trim();
  const uid = String(data?.uid ?? actorUid).trim();
  const planIdRaw = String(data?.planId ?? '').trim();

  if (!orgId) throw httpsError('invalid-argument', 'organizationId requerido.');
  if (!appAccountToken) throw httpsError('invalid-argument', 'appAccountToken requerido.');

  await requireCallerSuperAdminInOrg(actorUid, orgId);

  const resolvedPlanId = resolveEntitlementPlanId({
    metadataPlanId: planIdRaw || null,
  });

  const tokenRef = db.collection('appleAppAccountTokens').doc(appAccountToken);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tokenRef);

    const payload: Record<string, unknown> = {
      organizationId: orgId,
      uid,
      planId: resolvedPlanId,
      updatedAt: now,
      linkedBy: actorUid,
      source: 'registerAppleAppAccountToken_v1',
    };
    if (!snap.exists) {
      payload.createdAt = now;
    }
    tx.set(tokenRef, payload, { merge: true });
  });

  await auditLog({
    action: 'registerAppleAppAccountToken',
    actorUid,
    actorEmail,
    orgId,
    meta: { appAccountToken, uid, planId: resolvedPlanId },
  });

  return { ok: true, organizationId: orgId, appAccountToken };
});

export const appleAppStoreNotifications = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const rawBody = req.rawBody?.toString('utf8') ?? '';
  if (!rawBody) {
    res.status(400).send('Missing payload.');
    return;
  }

  let signedPayload: string | null = null;
  try {
    const parsed = JSON.parse(rawBody) as { signedPayload?: string };
    signedPayload = parsed.signedPayload ?? null;
  } catch (error) {
    console.error('appleAppStoreNotifications: invalid JSON', error);
    res.status(400).send('Invalid JSON.');
    return;
  }

  if (!signedPayload) {
    res.status(400).send('Missing signedPayload.');
    return;
  }

  const notificationPayload = decodeJwtPayload<AppleNotificationPayload>(signedPayload);
  const transactionPayload = decodeJwtPayload<AppleTransactionPayload>(
    notificationPayload?.data?.signedTransactionInfo ?? null
  );
  const renewalPayload = decodeJwtPayload<AppleRenewalPayload>(
    notificationPayload?.data?.signedRenewalInfo ?? null
  );

  const appAccountToken =
    transactionPayload?.appAccountToken ??
    renewalPayload?.appAccountToken ??
    notificationPayload?.data?.appAccountToken ??
    '';

  const { bundleId } = resolveAppleAppStoreConfig();
  if (bundleId && notificationPayload?.data?.bundleId && notificationPayload.data.bundleId !== bundleId) {
    res.status(400).send('Bundle mismatch.');
    return;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('appleAppStoreNotifications').add({
    signedPayload,
    notificationType: notificationPayload?.notificationType ?? null,
    subtype: notificationPayload?.subtype ?? null,
    appAccountToken: appAccountToken || null,
    bundleId: notificationPayload?.data?.bundleId ?? null,
    receivedAt: now,
    source: 'appleAppStoreNotifications_v1',
  });

  if (APPLE_UPDATES_ENABLED && appAccountToken) {
    const tokenSnap = await db.collection('appleAppAccountTokens').doc(appAccountToken).get();
    if (tokenSnap.exists) {
      const tokenData = tokenSnap.data() as { organizationId?: string; planId?: EntitlementPlanId } | undefined;
      const orgId = String(tokenData?.organizationId ?? '').trim();
      if (orgId) {
        const status = resolveEntitlementStatusFromApple(notificationPayload?.notificationType, renewalPayload);
        const currentPeriodEnd = toTimestampFromMillis(transactionPayload?.expiresDate ?? null);
        await updateOrganizationAppleEntitlement({
          orgId,
          planId: tokenData?.planId,
          status,
          currentPeriodEnd,
        });
      }
    }
  }

  res.status(200).send({ received: true });
});

export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  let event: StripeEvent;
  let webhookSecret: string;
  let secretKey: string;
  try {
    const config = resolveStripeConfig();
    if (!config) {
      res.status(501).send('Stripe not configured.');
      return;
    }
    webhookSecret = config.webhookSecret;
    secretKey = config.secretKey;
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      res.status(400).send('Missing Stripe signature.');
      return;
    }
    const payload = req.rawBody?.toString('utf8') ?? '';
    const valid = verifyStripeSignature({
      payload,
      signatureHeader: signature,
      webhookSecret,
    });
    if (!valid) {
      res.status(400).send('Invalid signature.');
      return;
    }
    event = JSON.parse(payload) as StripeEvent;
  } catch (error) {
    console.error('stripeWebhook: signature verification failed', error);
    res.status(400).send('Invalid signature.');
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as StripeCheckoutSession;
        const orgId = String(session.metadata?.orgId ?? '').trim();
        if (!orgId) {
          res.status(400).send('orgId missing in checkout session metadata.');
          return;
        }

        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (!subscriptionId) {
          res.status(400).send('Subscription missing in checkout session.');
          return;
        }

        const subscription = await fetchStripeSubscription(subscriptionId, secretKey);
        const status = resolveEntitlementStatusFromStripe(subscription.status ?? '');
        const planId = resolveEntitlementPlanId({
          metadataPlanId: session.metadata?.planId ?? subscription.metadata?.planId ?? null,
        });
        const trialEndsAt =
          subscription.trial_end != null
            ? admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000)
            : null;
        const currentPeriodEnd =
          subscription.current_period_end != null
            ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000)
            : null;

        await updateOrganizationStripeEntitlement({
          orgId,
          planId,
          status,
          trialEndsAt,
          currentPeriodEnd,
        });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as StripeSubscription;
        const orgId = String(subscription.metadata?.orgId ?? '').trim();
        if (!orgId) {
          res.status(400).send('orgId missing in subscription metadata.');
          return;
        }

        const status =
          event.type === 'customer.subscription.deleted'
            ? 'canceled'
            : resolveEntitlementStatusFromStripe(subscription.status);
        const planId = resolveEntitlementPlanId({
          metadataPlanId: subscription.metadata?.planId ?? null,
        });
        const trialEndsAt =
          subscription.trial_end != null
            ? admin.firestore.Timestamp.fromMillis(subscription.trial_end * 1000)
            : null;
        const currentPeriodEnd =
          subscription.current_period_end != null
            ? admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000)
            : null;

        await updateOrganizationStripeEntitlement({
          orgId,
          planId,
          status,
          trialEndsAt,
          currentPeriodEnd,
        });
        break;
      }
      default:
        break;
    }

    res.status(200).send({ received: true });
  } catch (error) {
    console.error('stripeWebhook: handler error', error);
    res.status(500).send('Webhook handler error.');
  }
});
