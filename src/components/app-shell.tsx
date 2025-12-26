"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Icons } from "@/components/icons";
import { MainNav } from "@/components/main-nav";
import { UserNav } from "@/components/user-nav";
import { useUser } from "@/lib/firebase";
import { DynamicClientLogo } from "@/components/dynamic-client-logo";

interface AppShellProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, description, action, children }: AppShellProps) {
  const { user, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  if (loading || !user) {
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
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
            <DynamicClientLogo />
          </div>
          <Link href="/" className="flex flex-col items-center gap-2">
            <span className="text-xl font-headline font-semibold text-sidebar-foreground">
              Maintelligence
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <MainNav />
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm lg:px-6">
          <SidebarTrigger className="md:hidden" />
          <div className="flex w-full items-center justify-end">{user && <UserNav />}</div>
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
