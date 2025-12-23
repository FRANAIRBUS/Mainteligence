'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useFirestore, useUser } from '@/lib/firebase';
import type { Ticket, User } from '@/lib/firebase/models';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  status: z.enum(['Abierta', 'En curso', 'En espera', 'Resuelta', 'Cerrada']),
  priority: z.enum(['Baja', 'Media', 'Alta', 'Crítica']),
  // assignedTo: z.string().optional(),
});

type EditIncidentFormValues = z.infer<typeof formSchema>;

interface EditIncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket;
  users: User[];
}

export function EditIncidentDialog({ open, onOpenChange, ticket, users }: EditIncidentDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: currentUser } = useUser();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<EditIncidentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      status: ticket.status,
      priority: ticket.priority,
      // assignedTo: ticket.assignedTo || '',
    },
  });

  useEffect(() => {
    form.reset({
      status: ticket.status,
      priority: ticket.priority,
      // assignedTo: ticket.assignedTo || '',
    });
  }, [ticket, form]);

  const onSubmit = async (data: EditIncidentFormValues) => {
    if (!firestore || !currentUser) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No autenticado o base de datos no disponible.',
      });
      return;
    }

    const userIsCreator = ticket.createdBy === currentUser.uid;
    // According to spec, only creator can change priority, but not status.
    // Maintenance and Admin can change anything. Let's simplify for now
    // and allow admin/maintenance to change both, creator can only change priority.

    if (userIsCreator && data.status !== ticket.status) {
        toast({
            variant: 'destructive',
            title: 'Permiso Denegado',
            description: 'No puedes cambiar el estado de la incidencia.',
        });
        return;
    }


    setIsPending(true);
    try {
      const ticketRef = doc(firestore, 'tickets', ticket.id);
      await updateDoc(ticketRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });

      toast({
        title: 'Éxito',
        description: `Incidencia '${ticket.title}' actualizada.`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Error al actualizar',
        description: e.message || 'Ocurrió un error inesperado.',
      });
    } finally {
      setIsPending(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isPending) {
      onOpenChange(isOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Incidencia</DialogTitle>
          <DialogDescription>
            Actualiza el estado, la prioridad o asigna la incidencia.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un estado" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Abierta">Abierta</SelectItem>
                      <SelectItem value="En curso">En curso</SelectItem>
                      <SelectItem value="En espera">En espera</SelectItem>
                      <SelectItem value="Resuelta">Resuelta</SelectItem>
                      <SelectItem value="Cerrada">Cerrada</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prioridad</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona una prioridad" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Baja">Baja</SelectItem>
                      <SelectItem value="Media">Media</SelectItem>
                      <SelectItem value="Alta">Alta</SelectItem>
                      <SelectItem value="Crítica">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* 
            <FormField
              control={form.control}
              name="assignedTo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Asignado A</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Sin asignar" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="">Sin asignar</SelectItem>
                      {users.map(user => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            */}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar Cambios
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
