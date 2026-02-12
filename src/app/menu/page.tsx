"use client";

import { AppShell } from "@/components/app-shell";
import { MainNav } from "@/components/main-nav";

export default function MenuPage() {
  return (
    <AppShell title="Menú" description="Accesos por módulos según tu rol.">
      <MainNav />
    </AppShell>
  );
}
