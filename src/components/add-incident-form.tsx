'use client';

import { useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { useToast } from '@/hooks/use-toast';
import { useFirestore, useUser, useStorage, useCollection } from '@/lib/firebase';
import type { Site, Department, Asset } from '@/lib/firebase/models';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError, StoragePermissionError } from '@/lib/firebase/errors';
import { orgCollectionPath, orgStoragePath } from '@/lib/organization';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { Icons } from '@/components/icons';

const formSchema = z.object({
  title: z
    .string()
    .min(5, { message: 'El título debe tener al menos 5 caracteres.' }),
  description: z
    .string()
    .min(10, { message: 'La descripción debe tener al menos 10 caracteres.' }),
  locationId: z.string({ required_error: 'Debe seleccionar una ubicación.' }),
  departmentId: z.string({ required_error: 'Debe seleccionar un departamento.' }),
  assetId: z
    .string()
    .optional()
    .transform((value) => (value && value !== '__none__' ? value : undefined)),
  priority: z.enum(['Baja', 'Media', 'Alta', 'Crítica'], {
    required_error: 'Debe seleccionar una prioridad.',
  }),
});

type AddIncidentFormValues = z.infer<typeof formSchema>;

export interface AddIncidentFormProps {
  onCancel?: () => void;
  onSuccess?: (payload: { title: string }) => void;
}

export function AddIncidentForm({ onCancel, onSuccess }: AddIncidentFormProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const storage = useStorage();
  const { user, organizationId } = useUser();
  const [isPending, setIsPending] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const canSubmit = Boolean(firestore && storage && user && organizationId);

  const { data: sites, loading: sitesLoading } = useCollection<Site>(
    organizationId ? orgCollectionPath(organizationId, 'sites') : null
  );
  const { data: departments, loading: deptsLoading } = useCollection<Department>(
    organizationId ? orgCollectionPath(organizationId, 'departments') : null
  );
  const { data: assets, loading: assetsLoading } = useCollection<Asset>(
    organizationId ? orgCollectionPath(organizationId, 'assets') : null
  );

  const form = useForm<AddIncidentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
      priority: 'Media',
      assetId: '__none__',
    },
  });

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setPhotos(Array.from(event.target.files));
    }
  };

  const onSubmit = async (data: AddIncidentFormValues) => {
    if (!canSubmit) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No autenticado o falta el organizationId para registrar la incidencia.',
      });
      return;
    }
    setIsPending(true);

    const photoUrls: string[] = [];

    try {
      const collectionRef = collection(firestore, orgCollectionPath(organizationId, 'tickets'));
      const ticketRef = doc(collectionRef);
      const ticketId = ticketRef.id;
      const docData = {
        ...data,
        locationId: data.locationId,
        type: 'correctivo' as const,
        status: 'new' as const,
        createdBy: user.uid,
        assignedRole: 'mantenimiento',
        assignedTo: null,
        organizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        photoUrls,
        displayId: `INC-${new Date().getFullYear()}-${String(new Date().getTime()).slice(-4)}`,
      };

      if (!docData.assetId) {
        delete docData.assetId;
      }

      await setDoc(ticketRef, docData);

      if (photos.length > 0) {
        try {
          for (const photo of photos) {
            const photoRef = ref(storage, orgStoragePath(organizationId, 'tickets', ticketId, photo.name));
            const snapshot = await uploadBytes(photoRef, photo);
            const url = await getDownloadURL(snapshot.ref);
            photoUrls.push(url);
          }

          if (photoUrls.length > 0) {
            await updateDoc(ticketRef, { photoUrls, updatedAt: serverTimestamp() });
          }
        } catch (error: any) {
          if (error.code === 'storage/unauthorized') {
            const permissionError = new StoragePermissionError({
              path: error.customData?.['path'] || orgStoragePath(organizationId, 'tickets', ticketId),
              operation: 'write',
            });
            errorEmitter.emit('permission-error', permissionError);
          } else if (error.code === 'permission-denied') {
            const permissionError = new FirestorePermissionError({
              path: orgCollectionPath(organizationId, 'tickets'),
              operation: 'update',
              requestResourceData: { photoUrls },
            });
            errorEmitter.emit('permission-error', permissionError);
          } else {
            toast({
              variant: 'destructive',
              title: 'Incidencia creada con adjuntos pendientes',
              description: error.message || 'No se pudieron guardar las fotos adjuntas.',
            });
          }
        }
      }

      onSuccess?.({ title: data.title });
      form.reset();
      setPhotos([]);
    } catch (error: any) {
      if (error.code === 'storage/unauthorized') {
        const permissionError = new StoragePermissionError({
          path: error.customData?.['path'] || orgStoragePath(organizationId, 'tickets', 'photos'),
          operation: 'write',
        });
        errorEmitter.emit('permission-error', permissionError);
      } else if (error.code === 'permission-denied') {
        const permissionError = new FirestorePermissionError({
          path: orgCollectionPath(organizationId, 'tickets'),
          operation: 'create',
          requestResourceData: data,
        });
        errorEmitter.emit('permission-error', permissionError);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error al crear la incidencia',
          description: error.message || 'Ocurrió un error inesperado.',
        });
      }
    } finally {
      setIsPending(false);
    }
  };

  const isLoading = sitesLoading || deptsLoading || assetsLoading;

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Icons.spinner className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Título</FormLabel>
              <FormControl>
                <Input placeholder="Ej: Fuga de agua en el baño" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea placeholder="Describe el problema en detalle..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
          name="locationId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ubicación</FormLabel>
                <Select
                  name={field.name}
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona una ubicación" />
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
          <FormField
            control={form.control}
            name="departmentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Departamento</FormLabel>
                <Select
                  name={field.name}
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="assetId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Activo (Opcional)</FormLabel>
                <Select
                  name={field.name}
                  onValueChange={field.onChange}
                  value={field.value ?? '__none__'}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un activo" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">Sin activo</SelectItem>
                    {assets.map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        {asset.name}
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
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prioridad</FormLabel>
                <Select
                  name={field.name}
                  onValueChange={field.onChange}
                  defaultValue={field.value}
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
        </div>

        <FormItem>
          <FormLabel>Fotos (Opcional)</FormLabel>
          <FormControl>
            <Input type="file" multiple onChange={handlePhotoChange} accept="image/*" />
          </FormControl>
          <FormMessage />
        </FormItem>
        {photos.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {photos.length} archivo(s) seleccionado(s).
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={!canSubmit || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear Incidencia
          </Button>
        </div>
      </form>
    </Form>
  );
}
