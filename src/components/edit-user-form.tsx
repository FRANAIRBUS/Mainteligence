'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp } from '@/lib/firebase';
import { useUser } from '@/lib/firebase/auth/use-user';
import type { User, Department } from '@/lib/firebase/models';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { normalizeRole } from '@/lib/rbac';

import { Button } from '@/components/ui/button';
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

type EditUserFormValues = z.infer<typeof formSchema>;

interface EditUserFormProps {
  user: User;
  departments: Department[];
  onSuccess?: () => void;
  onSubmitting?: (isSubmitting: boolean) => void;
}

export function EditUserForm({ user, departments, onSuccess, onSubmitting }: EditUserFormProps) {
  const { toast } = useToast();
  const app = useFirebaseApp();
  const { organizationId, user: currentUser } = useUser();

  const form = useForm<EditUserFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: user.displayName || '',
      email: user.email || '',
      role: normalizeRole(user.role) ?? user.role ?? 'operator',
      departmentId: user.departmentId || '',
    },
  });

  useEffect(() => {
    form.reset({
      displayName: user.displayName || '',
      email: user.email || '',
      role: normalizeRole(user.role) ?? user.role ?? 'operator',
      departmentId: user.departmentId || '',
    });
  }, [form, user]);

  const onSubmit = async (data: EditUserFormValues) => {
    if (!currentUser) {
      toast({
        variant: 'destructive',
        title: 'Error de autenticación',
        description: 'No se ha encontrado una sesión válida.',
      });
      return;
    }

    if (!app?.options?.projectId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Firebase no está inicializado correctamente.',
      });
      return;
    }

    if (!user || !organizationId || (user.organizationId && user.organizationId !== organizationId)) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Falta organizationId o el usuario pertenece a otra organización.',
      });
      return;
    }

    onSubmitting?.(true);

    const normalizedRole = normalizeRole(data.role) ?? data.role;
    const currentRole = normalizeRole(user.role) ?? user.role ?? 'operator';
    const roleChanged = normalizedRole !== currentRole;
    const updateData: Record<string, unknown> = {
      organizationId,
      uid: user.id,
      displayName: data.displayName,
      email: data.email,
      departmentId: data.departmentId || null,
    };

    try {
      if (roleChanged) {
        const fn = httpsCallable(getFunctions(app), 'setRoleWithinOrg');
        await fn({ organizationId, uid: user.id, role: normalizedRole });
      }

      const updateFn = httpsCallable(getFunctions(app), 'orgUpdateUserProfileCallable');
      await updateFn(updateData);
      toast({
        title: 'Éxito',
        description: `Usuario ${data.displayName} actualizado correctamente.`,
      });
      onSuccess?.();
    } catch (error: any) {
      if (error.code === 'permission-denied') {
        const permissionError = new FirestorePermissionError({
          path: `organizations/${organizationId}/members`,
          operation: 'update',
          requestResourceData: updateData,
        });
        errorEmitter.emit('permission-error', permissionError);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: error.message || 'No se pudo actualizar el usuario.',
        });
      }
    } finally {
      onSubmitting?.(false);
    }
  };

  return (
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
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rol</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value} name={field.name}>
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
                <Select name={field.name} onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un departamento" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {departments.map((dept) => (
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
        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Cambios
          </Button>
        </div>
      </form>
    </Form>
  );
}
