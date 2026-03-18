'use client';

import { useEffect } from 'react';
import { useForm, useFormState, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { useToast } from '@/hooks/use-toast';
import { useFirestore } from '@/lib/firebase';
import type { Asset, Site } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { generateCode } from '@/lib/code';
import { orgDocPath } from '@/lib/organization';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

const formSchema = z.object({
  name: z.string().min(2, { message: 'El nombre debe tener al menos 2 caracteres.' }),
  code: z.string().min(1, { message: 'El codigo no puede estar vacio.' }),
  siteId: z.string({ required_error: 'Debe seleccionar una ubicacion.' }).min(1, { message: 'Debe seleccionar una ubicacion.' }),
});

type EditAssetFormValues = z.infer<typeof formSchema>;

interface EditAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
  sites: Site[];
}

export function EditAssetDialog({ open, onOpenChange, asset, sites }: EditAssetDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();

  const form = useForm<EditAssetFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      code: '',
      siteId: '',
    },
  });
  const nameValue = useWatch({ control: form.control, name: 'name' });
  const { dirtyFields, isSubmitting } = useFormState({ control: form.control });

  useEffect(() => {
    if (!asset) {
      form.reset({ name: '', code: '', siteId: '' });
      return;
    }

    form.reset({
      name: asset.name || '',
      code: asset.code || '',
      siteId: asset.siteId || '',
    });
  }, [asset, form]);

  useEffect(() => {
    if (!asset || dirtyFields.code) {
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
  }, [asset, dirtyFields.code, form, nameValue]);

  const onSubmit = async (data: EditAssetFormValues) => {
    if (!firestore || !asset) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Firestore no esta disponible o no se encontro el activo.',
      });
      return;
    }

    if (!asset.organizationId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El activo no tiene organizationId asociado.',
      });
      return;
    }

    const assetRef = doc(firestore, orgDocPath(asset.organizationId, 'assets', asset.id));

    try {
      await updateDoc(assetRef, {
        name: data.name.trim(),
        code: data.code.trim(),
        siteId: data.siteId,
        updatedAt: serverTimestamp(),
      });

      toast({
        title: 'Exito',
        description: `Activo '${data.name}' actualizado correctamente.`,
      });
      onOpenChange(false);
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        const permissionError = new FirestorePermissionError({
          path: assetRef.path,
          operation: 'update',
          requestResourceData: data,
        });
        errorEmitter.emit('permission-error', permissionError);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error al actualizar',
          description: error?.message || 'No se pudo actualizar el activo.',
        });
      }
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isSubmitting) {
      onOpenChange(isOpen);
    }
  };

  if (!asset) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Editar Activo</DialogTitle>
          <DialogDescription>
            Modifica los datos de {asset.name}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre del activo</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Camara Frio 1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
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
                    <Select onValueChange={field.onChange} value={field.value} name={field.name}>
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
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Guardar Cambios
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}