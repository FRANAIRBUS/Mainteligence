'use client';

import { useMemo } from 'react';
import { useUser } from '@/lib/firebase/auth/use-user';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function OrgSwitcher() {
  const { memberships, organizationId, setActiveOrganizationId, loading, isRoot } = useUser();

  const options = useMemo(() => {
    return (memberships ?? [])
      .filter((m) => m.status === 'active' && m.organizationId)
      .map((m) => ({
        id: m.organizationId,
        name: m.organizationName || m.organizationId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [memberships]);

  if (loading || isRoot) return null;
  if (options.length < 2) return null;

  return (
    <div className="w-full">
      <Select value={organizationId ?? undefined} onValueChange={(v) => setActiveOrganizationId(v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Seleccionar organización" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
