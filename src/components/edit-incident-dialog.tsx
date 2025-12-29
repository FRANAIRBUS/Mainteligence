'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useFirestore, useUser, useDoc } from '@/lib/firebase';
import type { Ticket, User, Department } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { sendAssignmentEmail } from '@/lib/assignment-email';

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
  assignedTo: z.string().optional().nullable(),
  departmentId: z.string().optional(),
});

type EditIncidentFormValues = z.infer<typeof formSchema>;

interface EditIncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket;
  users: User[];
  departments: Department[];
}

export function EditIncidentDialog({ open, onOpenChange, ticket, users = [], departments = [] }: EditIncidentDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: currentUser, loading: userLoading } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(currentUser ? `users/${currentUser.uid}` : null);

  const [isPending, setIsPending] = useState(false);

  const form = useForm<EditIncidentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo || null,
      departmentId: ticket.departmentId || '',
    },
  });

  useEffect(() => {
    form.reset({
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo || null,
      departmentId: ticket.departmentId || '',
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

    setIsPending(true);
    
    const ticketRef = doc(firestore, 'tickets', ticket.id);
    const newAssignee = data.assignedTo === 'null' ? null : data.assignedTo;

    const updateData: any = {
      status: data.status,
      priority: data.priority,
      departmentId: data.departmentId,
      assignedTo: newAssignee,
      updatedAt: serverTimestamp(),
    };
    
    try {
      const previousAssignee = ticket.assignedTo ?? null;

      await updateDoc(ticketRef, updateData);

      if (newAssignee && newAssignee !== previousAssignee) {
        await sendAssignmentEmail({
          firestore,
          users,
          departments,
          assignedTo: newAssignee,
          departmentId: ticket.departmentId,
          title: ticket.title,
          identifier: ticket.displayId,
          description: ticket.description,
          priority: data.priority,
          status: data.status,
          location: ticket.departmentId,
          category: ticket.type,
          link: `${window.location.origin}/incidents/${ticket.id}`,
          type: 'incidencia',
        });
      }
      toast({
        title: 'Éxito',
        description: `Incidencia '${ticket.title}' actualizada.`,
      });
      onOpenChange(false);
    } catch(error: any) {
        if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: ticketRef.path,
            operation: 'update',
            requestResourceData: updateData,
          });
          errorEmitter.emit('permission-error', permissionError);
        } else {
          toast({
            variant: 'destructive',
            title: 'Error al actualizar',
            description: error.message || 'Ocurrió un error inesperado.',
          });
        }
    } finally {
        setIsPending(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isPending) {
      onOpenChange(isOpen);
    }
  };
  
  if (userLoading || profileLoading) {
    return null; // or a loader
  }

  const isCreator = ticket.createdBy === currentUser?.uid;
  const isAdmin = userProfile?.role === 'admin';
  const isMantenimiento = userProfile?.role === 'mantenimiento';

  const canEditStatus = isAdmin || isMantenimiento;
  const canEditPriority = isAdmin || isMantenimiento || isCreator;
  const canEditAssignment = isAdmin || isMantenimiento;
  const canEditDepartment = isAdmin;


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
                  <Select
                    name={field.name}
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={!canEditStatus}
                  >
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
                  <Select
                    name={field.name}
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={!canEditPriority}
                  >
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
            
            {canEditAssignment && (
              <FormField
                control={form.control}
                name="assignedTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asignado A</FormLabel>
                    {/* The value passed to the Select should be a string. We use 'null' as a string to represent the null value. */}
                    <Select
                      name={field.name}
                      onValueChange={field.onChange}
                      value={field.value || 'null'}
                      disabled={!canEditAssignment}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin asignar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="null">Sin asignar</SelectItem>
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
            )}

            {canEditDepartment && (
              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departamento</FormLabel>
                    <Select
                      name={field.name}
                      onValueChange={field.onChange}
                      value={field.value || ''}
                      disabled={!canEditDepartment}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un departamento" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {departments.map(dept => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            
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
