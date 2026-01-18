'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useFirestore, useUser, useDoc } from '@/lib/firebase';
import type { Ticket, User, Department, OrganizationMember } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { getTicketPermissions } from '@/lib/rbac';
import { sendAssignmentEmail } from '@/lib/assignment-email';
import { orgDocPath } from '@/lib/organization';

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
  users: OrganizationMember[];
  departments: Department[];
}

export function EditIncidentDialog({ open, onOpenChange, ticket, users = [], departments = [] }: EditIncidentDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const { user: currentUser, loading: userLoading, organizationId } = useUser();
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
    if (!firestore || !currentUser || !organizationId || ticket.organizationId !== organizationId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No autenticado, falta organizationId o la incidencia pertenece a otra organización.',
      });
      return;
    }

    const canEditSomething = canEditStatus || canEditPriority || canEditAssignment || canEditDepartment;

    if (!canEditSomething) {
      toast({
        variant: 'destructive',
        title: 'Permisos insuficientes',
        description: 'No tienes permisos para editar esta incidencia.',
      });
      return;
    }

    setIsPending(true);
    
    const ticketRef = doc(firestore, orgDocPath(organizationId, 'tickets', ticket.id));
    const newAssignee = data.assignedTo === 'null' ? null : data.assignedTo ?? null;

    const updateData: Record<string, unknown> = {
      organizationId,
      updatedAt: serverTimestamp(),
    };

    if (canEditStatus) {
      updateData.status = data.status;

      // When closing, stamp closure metadata for reporting.
      if (data.status === 'Cerrada') {
        updateData.closedAt = serverTimestamp();
        updateData.closedBy = currentUser.uid;
      }
    }

    if (canEditPriority) {
      updateData.priority = data.priority;
    }

    if (canEditDepartment) {
      updateData.departmentId = data.departmentId;
    }

    const assignmentChanged = canEditAssignment && newAssignee !== (ticket.assignedTo ?? null);

    if (assignmentChanged) {
      updateData.assignedTo = newAssignee;

      if (newAssignee) {
        updateData.assignmentEmailSource = 'client';
      }
    }
    
    try {
      await updateDoc(ticketRef, updateData);

      if (assignmentChanged && newAssignee) {
        const baseUrl =
          typeof window !== 'undefined'
            ? window.location.origin
            : 'https://multi.maintelligence.app';
        const departmentName = data.departmentId
          ? departments.find((dept) => dept.id === data.departmentId)?.name || data.departmentId
          : '';

        void (async () => {
          try {
            await sendAssignmentEmail({
              users,
              departments,
              assignedTo: newAssignee,
              departmentId: data.departmentId || null,
              title: ticket.title,
              link: `${baseUrl}/incidents/${ticket.id}`,
              type: 'incidencia',
              identifier: ticket.displayId || ticket.id,
              description: ticket.description ?? '',
              priority: data.priority,
              status: data.status,
              location: departmentName,
            });
          } catch (error) {
            console.error('No se pudo enviar el email de asignación de incidencia', error);
          }
        })();
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

  const permissions = getTicketPermissions(ticket, userProfile ?? null, currentUser?.uid ?? null);
  const canAssignAnyUser = permissions.canAssignAnyUser;
  const canAssignToSelf = permissions.canAssignToSelf;
  const canEditAssignment = canAssignAnyUser || canAssignToSelf;
  const canEditStatus = permissions.canChangeStatus;
  const canEditPriority = permissions.canChangePriority;
  const canEditDepartment = permissions.canChangeDepartment;

  const currentAssignee =
    ticket.assignedTo && users ? users.find((userOption) => userOption.id === ticket.assignedTo) : null;

  const selectableUsers = (() => {
    if (canAssignAnyUser) return users;
    if (canAssignToSelf && currentUser) return users.filter((userOption) => userOption.id === currentUser.uid);
    return [];
  })();

  const assignmentOptions =
    currentAssignee && !selectableUsers.some((userOption) => userOption.id === currentAssignee.id)
      ? [...selectableUsers, currentAssignee]
      : selectableUsers;


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
                      value={field.value ?? 'null'}
                      disabled={!canEditAssignment}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin asignar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="null">Sin asignar</SelectItem>
                        {assignmentOptions.map(userOption => (
                          <SelectItem key={userOption.id} value={userOption.id}>
                            {userOption.displayName}
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
