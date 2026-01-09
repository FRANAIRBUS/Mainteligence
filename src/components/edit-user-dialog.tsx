'use client';

import { useState } from 'react';

import { EditUserForm } from '@/components/edit-user-form';
import type { User, Department } from '@/lib/firebase/models';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
  departments: Department[];
}

export function EditUserDialog({ open, onOpenChange, user, departments }: EditUserDialogProps) {
  const [isPending, setIsPending] = useState(false);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isPending) {
      onOpenChange(isOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Usuario</DialogTitle>
          <DialogDescription>
            Modifica los detalles de {user.displayName}.
          </DialogDescription>
        </DialogHeader>
        <EditUserForm
          user={user}
          departments={departments}
          onSubmitting={setIsPending}
          onSuccess={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
