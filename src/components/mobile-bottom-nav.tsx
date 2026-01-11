"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import React, { useState } from "react";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { useAppNavigation } from "./main-nav";
import { cn } from "@/lib/utils";

const PRIMARY_PATHS = ["/", "/tasks", "/incidents", "/preventive"];

export function MobileBottomNav() {
  const { menuItems, userLoading } = useAppNavigation();
  const [moreOpen, setMoreOpen] = useState(false);

  if (userLoading) return null;

  const allItems = menuItems.flatMap((group) => group.items);
  if (!allItems.length) return null;

  const primaryCandidates = PRIMARY_PATHS.map((path) => allItems.find((item) => item.href === path)).filter(
    (item): item is (typeof allItems)[number] => Boolean(item)
  );
  const displayPrimary = primaryCandidates.slice(0, 3);
  const selected = new Set<string>();

  displayPrimary.forEach((item) => selected.add(item.href));

  for (const item of allItems) {
    if (displayPrimary.length >= 3) break;
    if (selected.has(item.href)) continue;
    displayPrimary.push(item);
    selected.add(item.href);
  }

  const moreItems = allItems.filter((item) => !selected.has(item.href));
  const showMore = moreItems.length > 0;

  return (
    <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="grid grid-cols-4 divide-x divide-border text-xs font-semibold text-muted-foreground">
          {displayPrimary.slice(0, 3).map((item) => (
            <MobileNavButton key={item.href} href={item.href} label={item.label} icon={item.icon} active={item.active} />
          ))}
          {showMore ? (
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex flex-col items-center justify-center gap-1 py-3 transition hover:bg-muted/60 active:bg-muted/80"
                aria-label="Abrir más opciones"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
                  <MoreHorizontal className="h-5 w-5" />
                </div>
                <span>Más</span>
              </button>
            </SheetTrigger>
          ) : (
            <span className="flex flex-col items-center justify-center gap-1 py-3 text-muted-foreground/60">Sin más</span>
          )}
        </div>
      </nav>

      <SheetContent side="bottom" className="pb-6">
        <SheetHeader className="text-left">
          <SheetTitle>Más opciones</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {moreItems.map((item) => (
            <SheetClose asChild key={item.href}>
              <MobileNavButton
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={item.active}
                onSelect={() => setMoreOpen(false)}
              />
            </SheetClose>
          ))}
        </div>
        {moreItems.length === 0 && <p className="text-sm text-muted-foreground">No hay más accesos disponibles.</p>}
      </SheetContent>
    </Sheet>
  );
}

type MobileNavButtonProps = {
  href: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  active: boolean;
  onSelect?: () => void;
};

function MobileNavButton({ href, label, icon: Icon, active, onSelect }: MobileNavButtonProps) {
  return (
    <Link
      href={href}
      onClick={() => onSelect?.()}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-1 py-3 transition hover:bg-muted/60 active:bg-muted/80",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border text-foreground",
          active ? "border-primary/60 bg-primary/10" : "border-transparent bg-muted"
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-[11px] leading-tight">{label}</span>
    </Link>
  );
}
