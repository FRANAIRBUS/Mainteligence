'use client';
import { Button } from '@/components/ui/button';
import { DynamicClientLogo } from '@/components/dynamic-client-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUser, useAuth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function UserNav() {
  const { user, loading, organizationId, memberships, setActiveOrganizationId, activeMembership } = useUser();
  const auth = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  };

  if (loading) {
    return <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />;
  }
  
  if (!user) {
    return null;
  }

  const getInitials = (name?: string | null) => {
    if (!name) return 'AD';
    const names = name.split(' ');
    if (names.length > 1) {
      return names[0][0] + names[names.length - 1][0];
    }
    return name.substring(0, 2);
  };

  const activeOrganizationName = activeMembership?.organizationName || organizationId || 'Org sin nombre';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <DynamicClientLogo
            width={32}
            height={32}
            className="h-8 w-8 rounded-full bg-muted p-1"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user.displayName || 'Usuario'}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email || 'Sin correo electrónico'}
            </p>
            {organizationId && (
              <p className="text-xs leading-none text-muted-foreground">
                Org. activa: {activeOrganizationName}
              </p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">
              Organizaciones
            </DropdownMenuLabel>
            {memberships.map((membership) => (
              <DropdownMenuItem
                key={membership.id}
                className="flex items-center justify-between"
                onClick={() => setActiveOrganizationId(membership.organizationId)}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {membership.organizationName || membership.organizationId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Rol: {membership.role}
                  </span>
                </span>
                {organizationId === membership.organizationId && (
                  <span className="text-xs text-emerald-600">Activa</span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        <DropdownMenuGroup>
           <DropdownMenuItem asChild>
            <Link href="/profile">
              Perfil
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              Ajustes
              <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          Cerrar sesión
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
