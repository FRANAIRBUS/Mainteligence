'use client';

import { AddIncidentForm } from '@/components/add-incident-form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AddIncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddIncidentDialog({ open, onOpenChange }: AddIncidentDialogProps) {
  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Crear Nueva Incidencia</DialogTitle>
          <DialogDescription>
            Describe el problema para que el equipo de mantenimiento pueda solucionarlo.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AddIncidentForm
            onCancel={() => onOpenChange(false)}
            onSuccess={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
