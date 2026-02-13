"use client";

import { AppShell } from "@/components/app-shell";
import { DynamicClientLogo } from "@/components/dynamic-client-logo";
import { useAppNavigation } from "@/components/main-nav";
import { useUser } from "@/lib/firebase";
import Link from "next/link";

export default function MenuPage() {
  const { activeMembership, loading: userLoading } = useUser();
  const { menuItems, userLoading: navLoading } = useAppNavigation();

  const organizationName = activeMembership?.organizationName || "Mainteligence";

  return (
    <AppShell title={organizationName} description="Menú">
      {/* Logo card (compact) */}
      <div className="mb-4 rounded-2xl border border-white/70 bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted/60">
            {/* Máximo tamaño visible para logo sin romper layout */}
            <DynamicClientLogo width={44} height={44} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{organizationName}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {userLoading ? "Cargando organización…" : "Organización activa"}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation cards (role-filtered, same source as MainNav) */}
      <div className="flex w-full flex-col gap-4">
        {navLoading ? (
          <div className="flex w-full flex-col gap-3">
            <div className="space-y-2">
              <div className="h-4 w-24 rounded-full bg-muted" />
              <div className="h-10 w-full rounded-xl bg-muted" />
              <div className="h-10 w-full rounded-xl bg-muted" />
            </div>
            <div className="mt-2 space-y-2">
              <div className="h-4 w-28 rounded-full bg-muted" />
              <div className="h-10 w-full rounded-xl bg-muted" />
              <div className="h-10 w-full rounded-xl bg-muted" />
              <div className="h-10 w-full rounded-xl bg-muted" />
            </div>
          </div>
        ) : (
          menuItems.map((group) => (
            <div
              key={group.label}
              className="rounded-2xl border border-white/70 bg-card shadow-sm"
            >
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{group.label}</p>
                <span className="text-xs font-medium text-muted-foreground">
                  {group.items.length} opciones
                </span>
              </div>

              <div className="grid gap-2 px-3 pb-3">
                {group.items.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={
                      "flex items-center gap-3 rounded-xl border px-3 py-3 text-sm font-semibold transition " +
                      (item.active
                        ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                        : "border-transparent bg-muted/30 text-muted-foreground hover:border-muted hover:bg-muted/60")
                    }
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/70 text-foreground">
                      {(() => {
                      const Icon = item.icon as any;
                      return Icon ? <Icon className="h-4 w-4" /> : null;
                    })()}
                    </span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.active ? (
                      <span className="text-[10px] font-semibold uppercase text-primary">activo</span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
