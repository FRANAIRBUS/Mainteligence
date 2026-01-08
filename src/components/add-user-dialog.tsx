'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useFirebaseApp, useUser } from '@/lib/firebase';
import type { Department } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { normalizeRole } from '@/lib/rbac';

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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

const roleValues = [
  'super_admin',
  'admin',
  'maintenance',
  'dept_head_multi',
  'dept_head_single',
  'operator',
  'mantenimiento',
  'operario',
] as const;

const roleOptions = [
  { value: roleValues[0], label: 'Super Admin' },
  { value: roleValues[1], label: 'Administrador' },
  { value: roleValues[2], label: 'Mantenimiento' },
  { value: roleValues[3], label: 'Jefe de Departamento (múltiples)' },
  { value: roleValues[4], label: 'Jefe de Departamento (único)' },
  { value: roleValues[5], label: 'Operario' },
  { value: roleValues[6], label: 'Mantenimiento (legacy)' },
  { value: roleValues[7], label: 'Operario (legacy)' },
] as const;

const formSchema = z.object({
  displayName: z
    .string()
    .min(2, { message: 'El nombre debe tener al menos 2 caracteres.' }),
  email: z.string().email({ message: 'Por favor, ingrese un correo electrónico válido.' }),
  role: z.enum(roleValues),
  departmentId: z.string().optional(),
});

type AddUserFormValues = z.infer<typeof formSchema>;

const departmentNoneValue = '__none__';

interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments?: Department[];
}

export function AddUserDialog({ open, onOpenChange, departments }: AddUserDialogProps) {
  const { toast } = useToast();
  const app = useFirebaseApp();
  const { user: currentUser, organizationId } = useUser();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<AddUserFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: '',
      email: '',
      role: 'operator',
      departmentId: departmentNoneValue,
    },
  });

  const onSubmit = async (data: AddUserFormValues) => {
    if (!currentUser) {
      toast({
        variant: 'destructive',
        title: 'Error de autenticación',
        description: 'No se ha encontrado una sesión válida.',
      });
      return;
    }

    if (!organizationId) {
      throw new Error('Critical: Missing organizationId in transaction');
    }
    setIsPending(true);

    try {
      const normalizedRole = normalizeRole(data.role);
      const fn = httpsCallable(getFunctions(app), 'orgInviteUser');
      const selectedDepartmentId =
        data.departmentId && data.departmentId !== departmentNoneValue ? data.departmentId : null;
      await fn({
        organizationId,
        displayName: data.displayName,
        email: data.email,
        role: normalizedRole,
        departmentId: selectedDepartmentId,
      });
      toast({
          title: 'Éxito',
          description: `Invitación enviada a ${data.email}. Se añadirá cuando complete el registro.`,
      });
      onOpenChange(false);
      form.reset();
    } catch (error: any) {
        if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: `organizations/${organizationId}/joinRequests`,
            operation: 'create',
            requestResourceData: {
              displayName: data.displayName,
              email: data.email,
              role: data.role,
              departmentId:
                data.departmentId && data.departmentId !== departmentNoneValue ? data.departmentId : null,
            },
          });
          errorEmitter.emit('permission-error', permissionError);
        } else {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error.message || 'No se pudo crear el perfil de usuario.',
            });
        }
    } finally {
        setIsPending(false);
    }
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    if (!isPending) {
        onOpenChange(isOpen);
        if(!isOpen) {
            form.reset();
        }
    }
  }

  const departmentOptions = departments ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Invitar Usuario</DialogTitle>
          <DialogDescription>
            Envía una invitación con rol y departamento. El usuario deberá registrarse usando este mismo email.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="John Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Correo Electrónico</FormLabel>
                  <FormControl>
                    <Input placeholder="john.doe@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
               <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rol</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      name={field.name}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un rol" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {roleOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departamento</FormLabel>
                    <Select
                      name={field.name}
                      onValueChange={field.onChange}
                      value={field.value ?? departmentNoneValue}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Opcional" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={departmentNoneValue}>Ninguno</SelectItem>
                        {departmentOptions.map((dept) => (
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
            </div>
            <DialogFooter>
               <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Enviar Invitación
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
