"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Icons } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/firebase";
import { useRootAccess } from "@/lib/root-admin/use-root-access";
import { cn } from "@/lib/utils";

interface RootAdminShellProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

const navItems = [
  { href: "/root-admin", label: "Resumen", icon: "gauge" },
  { href: "/root-admin/organizations", label: "Organizaciones", icon: "building" },
  { href: "/root-admin/audit-log", label: "Auditoría", icon: "shield" },
];

const iconMap: Record<string, ReactNode> = {
  gauge: <Icons.layout className="h-4 w-4" />,
  building: <Icons.building className="h-4 w-4" />,
  shield: <Icons.shield className="h-4 w-4" />,
};

export function RootAdminShell({ title, description, action, children }: RootAdminShellProps) {
  const { user, loading: userLoading } = useUser();
  const { isRoot, loading: rootLoading } = useRootAccess();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!userLoading && !user) {
      router.replace("/login?next=/root-admin");
      return;
    }

    if (!rootLoading && user && !isRoot) {
      router.replace("/");
    }
  }, [isRoot, rootLoading, router, user, userLoading]);

  const busy = userLoading || rootLoading || !user || !isRoot;

  if (busy) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4 text-center">
          <Link href="/root-admin" className="flex flex-col items-center gap-2">
            <Icons.shield className="h-10 w-10 text-sidebar-foreground" />
            <span className="text-xl font-headline font-semibold text-sidebar-foreground">
              Consola Root
            </span>
            <Badge variant="secondary" className="mt-1">Privado</Badge>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <nav className="space-y-1 p-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                  )}
                >
                  <span className="text-muted-foreground">{iconMap[item.icon]}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm lg:px-6">
          <SidebarTrigger className="md:hidden" />
          <div className="flex w-full items-center justify-end gap-2">
            <Badge variant="outline" className="hidden md:inline-flex">Root</Badge>
            <Button variant="ghost" size="icon" onClick={() => router.push("/")}>
              <Icons.home className="h-5 w-5" />
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 md:p-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
                {description && (
                  <p className="mt-2 text-muted-foreground">{description}</p>
                )}
              </div>
              {action}
            </div>
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
