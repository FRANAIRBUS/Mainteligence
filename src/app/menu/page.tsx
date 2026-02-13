"use client";

import { AppShell } from "@/components/app-shell";
import { MainNav } from "@/components/main-nav";
import { useUser } from "@/lib/firebase";

export default function MenuPage() {
  const { activeMembership, organizationId } = useUser();

  const organizationLabel =
    activeMembership?.organizationName ??
    activeMembership?.organizationId ??
    organizationId ??
    "Organización";

  return (
    <AppShell title="Menú" description={organizationLabel}>
      <MainNav />
    </AppShell>
  );
}
