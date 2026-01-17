'use client';

import { useEffect, useMemo } from 'react';
import { useDoc, useUser } from '@/lib/firebase';
import type { Organization } from '@/lib/firebase/models';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const NOTICE_DAYS = new Set([7, 12, 14]);
const MS_PER_DAY = 86_400_000;

function getDaysRemaining(expiresAt: Organization['demoExpiresAt']) {
  const date = expiresAt?.toDate?.();
  if (!date) return null;
  const diffMs = date.getTime() - Date.now();
  const rawDays = Math.ceil(diffMs / MS_PER_DAY);
  return Math.max(0, rawDays);
}

function getNoticeKey(orgId: string, day: number, now: Date) {
  const isoDate = now.toISOString().slice(0, 10);
  return `demo-notice:${orgId}:${day}:${isoDate}`;
}

export function DemoModeBanner({ className }: { className?: string }) {
  const { organizationId, loading: userLoading, isRoot } = useUser();
  const { toast } = useToast();
  const { data: organization } = useDoc<Organization>(
    organizationId ? `organizations/${organizationId}` : null
  );

  const isDemo = organization?.type === 'demo' || organization?.subscriptionPlan === 'trial';
  const daysRemaining = useMemo(
    () => (organization?.demoExpiresAt ? getDaysRemaining(organization.demoExpiresAt) : null),
    [organization?.demoExpiresAt]
  );

  useEffect(() => {
    if (!organizationId || !isDemo || daysRemaining == null) return;
    if (!NOTICE_DAYS.has(daysRemaining)) return;

    const now = new Date();
    const noticeKey = getNoticeKey(organizationId, daysRemaining, now);
    if (typeof window !== 'undefined' && window.localStorage.getItem(noticeKey)) return;

    toast({
      title: 'Recordatorio de demo',
      description: `Tu demo expira en ${daysRemaining} días. Actualiza el plan para continuar sin interrupciones.`,
    });

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(noticeKey, 'shown');
    }
  }, [daysRemaining, isDemo, organizationId, toast]);

  if (userLoading || isRoot || !isDemo || daysRemaining == null) return null;

  return (
    <div
      className={cn(
        'w-full border-b border-amber-500/30 bg-amber-500/15 px-4 py-2 text-xs text-amber-100 sm:text-sm',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2">
        <span className="font-semibold">Modo DEMO</span>
        <span className="text-amber-100/90">quedan {daysRemaining} días</span>
      </div>
    </div>
  );
}

export default DemoModeBanner;
