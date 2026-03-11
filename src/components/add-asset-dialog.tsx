'use client';

import { useEffect, useState } from 'react';
import { useForm, useFormState, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useDoc, useFirebaseApp, useUser } from '@/lib/firebase';
import type { IotPanelType, Organization, Site } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { canCreate } from '@/lib/entitlements';
import { orgCollectionPath } from '@/lib/organization';
import { generateCode } from '@/lib/code';

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
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';

const panelTypes: { value: IotPanelType; label: string }[] = [
  { value: 'thermostat', label: 'Termostato' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'relay', label: 'Reles' },
];

const formSchema = z
  .object({
    name: z.string().min(2, { message: 'El nombre debe tener al menos 2 caracteres.' }),
    code: z.string().min(1, { message: 'El codigo no puede estar vacio.' }),
    siteId: z.string({ required_error: 'Debe seleccionar una ubicacion.' }),
    iotEnabled: z.boolean().default(false),
    iotPanelType: z.enum(['thermostat', 'sensor', 'relay']).default('thermostat'),
    iotDeviceKey: z.string().optional(),
    iotLocationLabel: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (!values.iotEnabled) return;

    if (!values.iotDeviceKey || values.iotDeviceKey.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['iotDeviceKey'],
        message: 'Indica el identificador del dispositivo IoT.',
      });
    }
  });

type AddAssetFormValues = z.infer<typeof formSchema>;

interface AddAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: Site[];
}

const defaultValues: AddAssetFormValues = {
  name: '',
  code: '',
  siteId: '',
  iotEnabled: false,
  iotPanelType: 'thermostat',
  iotDeviceKey: '',
  iotLocationLabel: '',
};

export function AddAssetDialog({ open, onOpenChange, sites }: AddAssetDialogProps) {
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
  const canCreateAsset = hasEntitlementLimits
    ? canCreate('assets', organization?.entitlement?.usage, organization?.entitlement?.limits)
    : true;
  const isLimitBlocked = hasEntitlementLimits && !canCreateAsset;

  const form = useForm<AddAssetFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });
  const nameValue = useWatch({ control: form.control, name: 'name' });
  const codeValue = useWatch({ control: form.control, name: 'code' });
  const iotEnabled = useWatch({ control: form.control, name: 'iotEnabled' });
  const { dirtyFields } = useFormState({ control: form.control });

  useEffect(() => {
    if (dirtyFields.code) {
      return;
    }

    const nextCode = nameValue ? generateCode(nameValue) : '';
    if (nextCode !== form.getValues('code')) {
      form.setValue('code', nextCode, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: true,
      });
    }
  }, [dirtyFields.code, form, nameValue]);

  useEffect(() => {
    if (!iotEnabled || dirtyFields.iotDeviceKey) {
      return;
    }

    const nextDeviceKey = codeValue ? codeValue.toUpperCase() : '';
    if (nextDeviceKey !== form.getValues('iotDeviceKey')) {
      form.setValue('iotDeviceKey', nextDeviceKey, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [codeValue, dirtyFields.iotDeviceKey, form, iotEnabled]);

  const onSubmit = async (data: AddAssetFormValues) => {
    if (!app) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Firebase no esta disponible.',
      });
      return;
    }
    setIsPending(true);

    try {
      if (!organizationId) {
        throw new Error('Critical: Missing organizationId in transaction');
      }
      const fn = httpsCallable(getFunctions(app), 'createAsset');
      await fn({
        organizationId,
        payload: {
          name: data.name,
          code: data.code,
          siteId: data.siteId,
          ...(data.iotEnabled
            ? {
                iot: {
                  enabled: true,
                  panelType: data.iotPanelType,
                  deviceKey: data.iotDeviceKey?.trim(),
                  locationLabel: data.iotLocationLabel?.trim() || undefined,
                  dataSource: 'maintelligence_api',
                },
              }
            : {}),
        },
      });
      toast({
        title: 'Exito',
        description: `Activo '${data.name}' creado correctamente.`,
      });
      onOpenChange(false);
      form.reset(defaultValues);
    } catch (error: any) {
      const errorCode = String(error?.code ?? '');
      if (errorCode.includes('permission-denied')) {
        const permissionError = new FirestorePermissionError({
          path: organizationId ? orgCollectionPath(organizationId, 'assets') : 'assets',
          operation: 'create',
          requestResourceData: data,
        });
        errorEmitter.emit('permission-error', permissionError);
      } else if (errorCode.includes('failed-precondition')) {
        toast({
          variant: 'destructive',
          title: 'Limite alcanzado',
          description: error.message || 'No es posible crear mas activos con tu plan actual.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error al crear el activo',
          description: error.message || 'Ocurrio un error inesperado.',
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
        form.reset(defaultValues);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Anadir Nuevo Activo</DialogTitle>
          <DialogDescription>
            Introduce los detalles del nuevo activo o equipo.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Nombre del activo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Camara Frio 1" {...field} />
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
                    <FormLabel>Codigo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: cf1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="siteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ubicacion</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} name={field.name}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona una ubicacion" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sites.map((site) => (
                          <SelectItem key={site.id} value={site.id}>
                            {site.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-xl border border-sky-200/50 bg-sky-50/40 p-4">
              <FormField
                control={form.control}
                name="iotEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Este activo es un dispositivo IoT</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Activa paneles de termostato, sensor o reles dentro de Mainteligence.
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              {iotEnabled ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="iotPanelType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo de panel</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} name={field.name}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona un panel" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {panelTypes.map((panelType) => (
                              <SelectItem key={panelType.value} value={panelType.value}>
                                {panelType.label}
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
                    name="iotDeviceKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ID del dispositivo</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej: LH-T300-OBR-01" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="iotLocationLabel"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Etiqueta visual del panel</FormLabel>
                        <FormControl>
                          <Input placeholder="Ej: Camara 1 - Obrador" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isPending || isLimitBlocked}>
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Crear Activo
              </Button>
              {isLimitBlocked ? (
                <p className="text-xs text-destructive">
                  Has alcanzado el limite de activos de tu plan actual.
                </p>
              ) : null}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

