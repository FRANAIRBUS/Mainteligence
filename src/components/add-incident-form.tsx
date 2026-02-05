'use client';

import { useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

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

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const UPLOAD_STALL_TIMEOUT_MS = 30_000;

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/msword',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'doc',
  'docx',
  'pdf',
  'txt',
  'xls',
  'xlsx',
]);

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
  const { user, organizationId, profile } = useUser();
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
    if (!event.target.files) return;

    const selectedFiles = Array.from(event.target.files);
    if (selectedFiles.length > MAX_ATTACHMENTS) {
      toast({
        variant: 'destructive',
        title: 'Demasiados adjuntos',
        description: `Puedes subir un máximo de ${MAX_ATTACHMENTS} archivos por incidencia.`,
      });
      event.target.value = '';
      setPhotos([]);
      return;
    }

    const invalidFiles = selectedFiles.filter((file) => {
      const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
      const allowedByMime = file.type.startsWith('image/') || ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type);
      const allowedByExtension = extension ? ALLOWED_ATTACHMENT_EXTENSIONS.has(extension) : false;
      const sizeAllowed = file.size > 0 && file.size <= MAX_ATTACHMENT_BYTES;
      return !(sizeAllowed && (allowedByMime || allowedByExtension));
    });

    if (invalidFiles.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Adjuntos inválidos',
        description:
          'Revisa formato y tamaño. Permitidos: imágenes, PDF, TXT, DOC, DOCX, XLS, XLSX (máx. 10 MB).',
      });
      event.target.value = '';
      setPhotos([]);
      return;
    }

    setPhotos(selectedFiles);
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const sanitizeFileName = (name: string) =>
    name
      .replace(/\\/g, '_')
      .replace(/\//g, '_')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(0, 120) || 'adjunto';

  const uniqueFileName = (originalName: string) => {
    const safe = sanitizeFileName(originalName);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${suffix}-${safe}`;
  };

  const uploadPhotoWithRetry = async (
    photo: File,
    photoRef: ReturnType<typeof ref>,
    attempts = 3
  ) => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const snapshot = await Promise.race([
          uploadBytes(photoRef, photo, {
            contentType: photo.type || 'application/octet-stream',
          }),
          sleep(UPLOAD_STALL_TIMEOUT_MS).then(() => {
            throw {
              code: 'storage/retry-limit-exceeded',
              message: 'La subida del archivo tardó demasiado tiempo.',
            };
          }),
        ]);

        return await getDownloadURL((snapshot as Awaited<ReturnType<typeof uploadBytes>>).ref);
      } catch (error: any) {
        lastError = error;
        const retryable =
          error?.code === 'storage/retry-limit-exceeded' ||
          error?.code === 'storage/unknown' ||
          error?.code === 'storage/network-error';
        if (!retryable || attempt === attempts) {
          break;
        }
        await sleep(500 * attempt);
      }
    }

    throw lastError;
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
    const failedUploads: string[] = [];
    let lastUploadError: any = null;

    try {
      const collectionRef = collection(firestore, orgCollectionPath(organizationId, 'tickets'));
      const ticketRef = doc(collectionRef);
      const ticketId = ticketRef.id;
      const uploadSessionRef = doc(
        firestore,
        orgCollectionPath(organizationId, 'uploadSessions'),
        ticketId
      );
      const createdByName = profile?.displayName || user.email || user.uid;

      // --- NUEVO FLUJO HARDENED ---
      // Objetivo: evitar incidencias "fantasma".
      // Si hay adjuntos, abrimos sesión temporal, subimos, y SOLO entonces creamos la incidencia.
      const shouldUseHardenedFlow = photos.length > 0;

      if (shouldUseHardenedFlow) {
        const uploadedRefs: Array<ReturnType<typeof ref>> = [];

        // 1) crear sesión de subida (si falla por rules, hacemos fallback al flujo legacy para no bloquear UX)
        try {
          const now = new Date();
          const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
          await setDoc(uploadSessionRef, {
            organizationId,
            uploaderUid: user.uid,
            type: 'ticket',
            status: 'active',
            createdAt: serverTimestamp(),
            expiresAt,
            maxFiles: MAX_ATTACHMENTS,
          });
        } catch (e: any) {
          // Si no podemos crear la sesión (rules viejas), no bloqueamos: caemos a legacy.
          if (e?.code !== 'permission-denied') throw e;
        }

        // 2) intentar subida (si hay sesión, rules dejan; si no, depende de rules legacy)
        try {
          for (const photo of photos) {
            const objectName = uniqueFileName(photo.name);
            const photoRef = ref(
              storage,
              orgStoragePath(organizationId, 'tickets', ticketId, objectName)
            );
            uploadedRefs.push(photoRef);
            const url = await uploadPhotoWithRetry(photo, photoRef);
            photoUrls.push(url);
          }
        } catch (error: any) {
          lastUploadError = error;
          // cleanup best-effort
          await Promise.allSettled(uploadedRefs.map((r) => deleteObject(r)));
          await Promise.allSettled([deleteDoc(uploadSessionRef)]);

          if (error?.code === 'storage/unauthorized') {
            const permissionError = new StoragePermissionError({
              path:
                error.customData?.['path'] ||
                orgStoragePath(organizationId, 'tickets', ticketId),
              operation: 'write',
            });
            errorEmitter.emit('permission-error', permissionError);
          } else {
            toast({
              variant: 'destructive',
              title: 'No se pudo subir el adjunto',
              description:
                error?.message || 'Ocurrió un error inesperado durante la subida.',
            });
          }
          return;
        }

        // Si llegamos aquí, o subimos todo o no había fotos (no aplica)
        // 3) crear incidencia con urls
        const hardenedDocData: any = {
          ...data,
          locationId: data.locationId,
          type: 'correctivo' as const,
          status: 'new' as const,
          createdBy: user.uid,
          createdByName,
          assignedRole: 'mantenimiento',
          assignedTo: null,
          organizationId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          photoUrls,
          hasAttachments: photoUrls.length > 0,
          displayId: `INC-${new Date().getFullYear()}-${String(new Date().getTime()).slice(-4)}`,
        };

        if (!hardenedDocData.assetId) delete hardenedDocData.assetId;

        await setDoc(ticketRef, hardenedDocData);
        await Promise.allSettled([deleteDoc(uploadSessionRef)]);

        onSuccess?.({ title: data.title });
        form.reset();
        setPhotos([]);
        return;
      }

      // --- FLUJO LEGACY (sin adjuntos) ---
      const docData = {
        ...data,
        locationId: data.locationId,
        type: 'correctivo' as const,
        status: 'new' as const,
        createdBy: user.uid,
        createdByName,
        assignedRole: 'mantenimiento',
        assignedTo: null,
        organizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        photoUrls: [],
        hasAttachments: false,
        displayId: `INC-${new Date().getFullYear()}-${String(new Date().getTime()).slice(-4)}`,
      };

      if (!docData.assetId) {
        delete docData.assetId;
      }

      await setDoc(ticketRef, docData);

      // --- LEGACY CON ADJUNTOS (por si se llega aquí con fotos en futuro) ---
      if (photos.length > 0) {
        for (const photo of photos) {
          const photoRef = ref(storage, orgStoragePath(organizationId, 'tickets', ticketId, photo.name));
          try {
            const url = await uploadPhotoWithRetry(photo, photoRef);
            photoUrls.push(url);
          } catch (error) {
            lastUploadError = error;
            failedUploads.push(photo.name);
          }
        }

        if (photoUrls.length > 0) {
          try {
            await updateDoc(ticketRef, {
              photoUrls,
              hasAttachments: true,
              updatedAt: serverTimestamp(),
            });
          } catch (error: any) {
            if (error.code === 'permission-denied') {
              const permissionError = new FirestorePermissionError({
                path: orgCollectionPath(organizationId, 'tickets'),
                operation: 'update',
                requestResourceData: { photoUrls },
              });
              errorEmitter.emit('permission-error', permissionError);
            } else {
              toast({
                variant: 'destructive',
                title: 'Incidencia creada con adjuntos incompletos',
                description: error.message || 'No se pudieron guardar las fotos adjuntas.',
              });
            }
          }
        }

        if (failedUploads.length > 0) {
          if (lastUploadError?.code === 'storage/unauthorized') {
            const permissionError = new StoragePermissionError({
              path: lastUploadError.customData?.['path'] || orgStoragePath(organizationId, 'tickets', ticketId),
              operation: 'write',
            });
            errorEmitter.emit('permission-error', permissionError);
          } else {
            toast({
              variant: 'destructive',
              title: 'Incidencia creada con adjuntos incompletos',
              description: `No se pudieron subir: ${failedUploads.join(', ')}.`,
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
            <Input
              type="file"
              multiple
              onChange={handlePhotoChange}
              accept="image/*,application/pdf,text/plain,.pdf,.doc,.docx,.xls,.xlsx"
            />
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
