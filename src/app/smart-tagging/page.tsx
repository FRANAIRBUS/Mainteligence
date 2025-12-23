import SmartTaggingForm from '@/components/smart-tagging-form';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { MainNav } from '@/components/main-nav';
import { UserNav } from '@/components/user-nav';
import { Icons } from '@/components/icons';
import Image from 'next/image';

export default function SmartTaggingPage() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
              <Image src="/client-logo.png" alt="Logo del Cliente" width={80} height={80} className="rounded-md" />
            </div>
            <a href="/" className="flex flex-col items-center gap-2">
                <span className="text-xl font-headline font-semibold text-sidebar-foreground">
                Maintelligence
                </span>
            </a>
        </SidebarHeader>
        <SidebarContent>
          <MainNav />
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm lg:px-6 sticky top-0 z-10">
          <SidebarTrigger className="md:hidden" />
          <div className="md:w-full"></div>
          <UserNav />
        </header>
        <main className="flex-1 p-4 sm:p-6 md:p-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-8">
            <div>
              <h1 className="font-headline text-3xl font-bold tracking-tight md:text-4xl">
                Asistente de Etiquetado Inteligente
              </h1>
              <p className="mt-2 text-muted-foreground">
                Categoriza automáticamente tus tareas de mantenimiento. Ingresa una
                descripción para obtener etiquetas sugeridas por IA.
              </p>
            </div>
            <div className="w-full">
              <SmartTaggingForm />
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
