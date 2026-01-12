'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  ClipboardList,
  AlertTriangle,
  Plus,
  MoreHorizontal,
} from 'lucide-react';

type Props = {
  onOpenMenu: () => void;
  onOpenCreate: () => void;
};

export default function MobileBottomNav({ onOpenMenu, onOpenCreate }: Props) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const itemClass = (active: boolean) =>
    cn(
      'flex flex-col items-center justify-center gap-1 px-2 py-1 text-[11px] leading-none',
      active ? 'text-primary' : 'text-muted-foreground'
    );

  const iconClass = (active: boolean) =>
    cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground');

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-around px-2">
        <Link href="/" className={itemClass(isActive('/'))} aria-label="Panel">
          <LayoutDashboard className={iconClass(isActive('/'))} />
          <span>Panel</span>
        </Link>

        <Link
          href="/incidents"
          className={itemClass(isActive('/incidents'))}
          aria-label="Incidencias"
        >
          <AlertTriangle className={iconClass(isActive('/incidents'))} />
          <span>Incid.</span>
        </Link>

        {/* Crear */}
        <Button
          type="button"
          variant="default"
          size="icon"
          onClick={onOpenCreate}
          className="h-10 w-10 rounded-full"
          aria-label="Crear"
        >
          <Plus className="h-5 w-5" />
        </Button>

        <Link
          href="/tasks"
          className={itemClass(isActive('/tasks'))}
          aria-label="Tareas"
        >
          <ClipboardList className={iconClass(isActive('/tasks'))} />
          <span>Tareas</span>
        </Link>

        {/* Más */}
        <button
          type="button"
          onClick={onOpenMenu}
          className={itemClass(false)}
          aria-label="Más"
        >
          <MoreHorizontal className={iconClass(false)} />
          <span>Más</span>
        </button>
      </div>
    </nav>
  );
}
