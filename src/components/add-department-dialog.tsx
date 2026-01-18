'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useDoc, useFirebaseApp, useUser } from '@/lib/firebase';
import type { Organization } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { canCreate } from '@/lib/entitlements';
import { orgCollectionPath } from '@/lib/organization';

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
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  name: z
    .string()
    .min(2, { message: 'El nombre debe tener al menos 2 caracteres.' }),
  code: z
    .string()
    .min(2, { message: 'El código debe tener al menos 2 caracteres.' }),
});

type AddDepartmentFormValues = z.infer<typeof formSchema>;

interface AddDepartmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddDepartmentDialog({ open, onOpenChange }: AddDepartmentDialogProps) {
  const { toast } = useToast();
  const app = useFirebaseApp();
  const { organizationId } = useUser();
  const [isPending, setIsPending] = useState(false);
  const { data: organization } = useDoc<Organization>(
    organizationId ? `organizations/${organizationId}` : null
  );
  const hasEntitlementLimits = Boolean(
    organization?.entitlement?.usage && organization?.entitlement?.limits
  );
  const canCreateDepartment = hasEntitlementLimits
    ? canCreate(
        'departments',
        organization?.entitlement?.usage,
        organization?.entitlement?.limits
      )
    : true;
  const isLimitBlocked = hasEntitlementLimits && !canCreateDepartment;

  const form = useForm<AddDepartmentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      code: '',
    },
  });

  const onSubmit = async (data: AddDepartmentFormValues) => {
    if (!app) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Firebase no está disponible.',
      });
      return;
    }
    setIsPending(true);

    try {
      if (!organizationId) {
        throw new Error('Critical: Missing organizationId in transaction');
      }
      const fn = httpsCallable(getFunctions(app), 'createDepartment');
      await fn({ organizationId, payload: data });
      toast({
        title: 'Éxito',
        description: `Departamento '${data.name}' creado correctamente.`,
      });
      onOpenChange(false);
      form.reset();
    } catch (error: any) {
      const errorCode = String(error?.code ?? '');
      if (errorCode.includes('permission-denied')) {
        const permissionError = new FirestorePermissionError({
          path: organizationId ? orgCollectionPath(organizationId, 'departments') : 'departments',
          operation: 'create',
          requestResourceData: data,
        });
        errorEmitter.emit('permission-error', permissionError);
      } else if (errorCode.includes('failed-precondition')) {
        toast({
          variant: 'destructive',
          title: 'Límite alcanzado',
          description: error.message || 'No es posible crear más departamentos con tu plan actual.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error al crear el departamento',
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
      if (!isOpen) {
        form.reset();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Añadir Nuevo Departamento</DialogTitle>
          <DialogDescription>
            Introduce los detalles del nuevo departamento.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del departamento</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Electricidad" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Código</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: elec" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={isPending || isLimitBlocked}>
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Crear Departamento
              </Button>
              {isLimitBlocked ? (
                <p className="text-xs text-destructive">
                  Has alcanzado el límite de departamentos de tu plan actual.
                </p>
              ) : null}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
