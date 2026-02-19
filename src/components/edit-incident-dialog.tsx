'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useFirestore, useUser, useDoc } from '@/lib/firebase';
import type { Ticket, User, Department, OrganizationMember } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { buildRbacUser, getTicketPermissions, normalizeRole } from '@/lib/rbac';
import { orgDocPath } from '@/lib/organization';
import { normalizeTicketStatus, ticketStatusLabel } from '@/lib/status';

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
  status: z.enum(['new', 'in_progress', 'resolved', 'canceled']),
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
  const { user: currentUser, loading: userLoading, organizationId, role } = useUser();
  const { data: userProfile, loading: profileLoading } = useDoc<User>(currentUser ? `users/${currentUser.uid}` : null);
  const { data: currentMember } = useDoc<OrganizationMember>(
    currentUser && organizationId ? orgDocPath(organizationId, 'members', currentUser.uid) : null
  );

  const [isPending, setIsPending] = useState(false);

  const form = useForm<EditIncidentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      status: normalizeTicketStatus(ticket.status) as EditIncidentFormValues['status'],
      priority: ticket.priority,
      assignedTo: ticket.assignedTo || null,
      departmentId:
        ticket.targetDepartmentId ?? ticket.originDepartmentId ?? ticket.departmentId ?? '',
    },
  });

  useEffect(() => {
    form.reset({
      status: normalizeTicketStatus(ticket.status) as EditIncidentFormValues['status'],
      priority: ticket.priority,
      assignedTo: ticket.assignedTo || null,
      departmentId:
        ticket.targetDepartmentId ?? ticket.originDepartmentId ?? ticket.departmentId ?? '',
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
    
    const newAssignee = data.assignedTo === 'null' ? null : data.assignedTo ?? null;

    const updateData: Record<string, unknown> = {};

    if (canEditStatus) {
      updateData.status = data.status;
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
    }
    
    try {
      const functions = getFunctions();
      const updateTicket = httpsCallable(functions, 'updateTicketStatus');
      await updateTicket({ orgId: organizationId, ticketId: ticket.id, patch: updateData });
        })();
      }

      toast({
        title: 'Éxito',
        description: `Incidencia '${ticket.title}' actualizada.`,
      });
      onOpenChange(false);
    } catch(error: any) {
        if (error?.code?.startsWith?.('functions/')) {
          toast({
            variant: 'destructive',
            title: 'No se pudo actualizar la incidencia',
            description: error.message || 'Ocurrió un error inesperado.',
          });
        } else if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: orgDocPath(organizationId, 'tickets', ticket.id),
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

  const normalizedRole = normalizeRole(role ?? userProfile?.role);
  const rbacUser = buildRbacUser({
    role,
    organizationId,
    member: currentMember,
    profile: userProfile ?? null,
  });
  const permissions = getTicketPermissions(ticket, rbacUser, currentUser?.uid ?? null);
  const canAssignAnyUser = permissions.canAssignAnyUser;
  const canAssignToSelf = permissions.canAssignToSelf;
  const canEditAssignment = canAssignAnyUser || canAssignToSelf;
  const canEditStatus = permissions.canChangeStatus;
  const canEditPriority = permissions.canChangePriority;
  const canEditDepartment = permissions.canChangeDepartment;

  const currentAssignee =
    ticket.assignedTo && users ? users.find((userOption) => userOption.id === ticket.assignedTo) : null;

  const selectableUsers = (() => {
    if (!users) return [];
    if (canAssignToSelf && currentUser) {
      return users.filter((userOption) => userOption.id === currentUser.uid);
    }
    if (!canAssignAnyUser) return [];
    const departmentScope = currentMember?.departmentId ?? userProfile?.departmentId ?? null;
    const locationScope = currentMember?.locationId ?? userProfile?.locationId ?? null;
    if (normalizedRole === 'jefe_departamento' && departmentScope) {
      return users.filter((userOption) => userOption.departmentId === departmentScope);
    }
    if (normalizedRole === 'jefe_ubicacion' && locationScope) {
      return users.filter((userOption) => userOption.locationId === locationScope);
    }
    return users;
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
                      <SelectItem value="new">{ticketStatusLabel("new")}</SelectItem>
                      <SelectItem value="in_progress">{ticketStatusLabel("in_progress")}</SelectItem>
                      <SelectItem value="resolved">{ticketStatusLabel("resolved")}</SelectItem>
                      <SelectItem value="canceled">{ticketStatusLabel("canceled")}</SelectItem>
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
