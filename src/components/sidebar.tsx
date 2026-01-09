'use client';

import { ClientLogo } from '@/components/client-logo';
import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import { OrgSwitcher } from '@/components/org-switcher';

export function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:bg-background">
      <div className="flex items-center justify-between gap-2 border-b p-4">
        <ClientLogo />
        <UserNav />
      </div>

      <div className="p-4">
        <OrgSwitcher />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <MainNav />
      </div>
    </aside>
  );
}
