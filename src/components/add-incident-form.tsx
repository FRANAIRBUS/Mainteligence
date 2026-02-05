'use client';

import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable, type UploadTaskSnapshot } from 'firebase/storage';

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

type SelectedAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
  progress: number;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  error: string | null;
};

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
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
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
      return;
    }

    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });

      return selectedFiles.map((file, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        progress: 0,
        status: 'pending',
        error: null,
      }));
    });

    event.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((attachment) => attachment.id !== id);
    });
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
    attachment: SelectedAttachment,
    ticketId: string,
    onProgress: (progress: number) => void,
    attempts = 2
  ) => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const objectName = uniqueFileName(attachment.file.name);
        const photoRef = ref(storage!, orgStoragePath(organizationId!, 'tickets', ticketId, objectName));

        const snapshot = await new Promise<UploadTaskSnapshot>((resolve, reject) => {
          const task = uploadBytesResumable(photoRef, attachment.file, {
            contentType: attachment.file.type || 'application/octet-stream',
          });

          let stallTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            task.cancel();
            reject({
              code: 'storage/retry-limit-exceeded',
              message: 'La subida del archivo tardó demasiado tiempo.',
            });
          }, UPLOAD_STALL_TIMEOUT_MS);

          task.on(
            'state_changed',
            (snapshot) => {
              const total = snapshot.totalBytes || attachment.file.size || 1;
              const progress = Math.max(1, Math.round((snapshot.bytesTransferred / total) * 100));
              onProgress(Math.min(progress, 99));

              if (stallTimer) clearTimeout(stallTimer);
              stallTimer = setTimeout(() => {
                task.cancel();
                reject({
                  code: 'storage/retry-limit-exceeded',
                  message: 'La subida del archivo tardó demasiado tiempo.',
                });
              }, UPLOAD_STALL_TIMEOUT_MS);
            },
            (error) => {
              if (stallTimer) clearTimeout(stallTimer);
              reject(error);
            },
            () => {
              if (stallTimer) clearTimeout(stallTimer);
              resolve(task.snapshot);
            }
          );
        });

        const url = await getDownloadURL(snapshot.ref);
        onProgress(100);
        return url;
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

  const mapUploadErrorMessage = (error: any) => {
    switch (error?.code) {
      case 'storage/unauthorized':
        return 'Sin permisos para subir este archivo. Revisa tus permisos de Storage.';
      case 'storage/canceled':
      case 'storage/retry-limit-exceeded':
        return 'La subida se interrumpió por tiempo de espera. Intenta nuevamente.';
      case 'storage/quota-exceeded':
        return 'Se superó la cuota de almacenamiento.';
      case 'storage/network-error':
        return 'Error de red durante la subida.';
      default:
        return error?.message || 'No se pudo subir el archivo.';
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

    const scopedFirestore = firestore!;
    const scopedUser = user!;
    const scopedOrganizationId = organizationId!;

    setIsPending(true);
    setSubmitWarning(null);

    let uploadSessionRefLocal: ReturnType<typeof doc> | null = null;

    try {
      const collectionRef = collection(scopedFirestore, orgCollectionPath(scopedOrganizationId, 'tickets'));
      const ticketRef = doc(collectionRef);
      const ticketId = ticketRef.id;
      const createdByName = profile?.displayName || scopedUser.email || scopedUser.uid;
      const uploadSessionRef = doc(
        scopedFirestore,
        orgCollectionPath(scopedOrganizationId, 'uploadSessions'),
        ticketId
      );
      uploadSessionRefLocal = uploadSessionRef;

      const urls: string[] = [];
      const failedUploads: string[] = [];

      if (attachments.length > 0) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
        await setDoc(uploadSessionRef, {
          organizationId: scopedOrganizationId,
          uploaderUid: scopedUser.uid,
          type: 'ticket',
          status: 'active',
          createdAt: serverTimestamp(),
          expiresAt,
          maxFiles: MAX_ATTACHMENTS,
        });

        const results = await Promise.allSettled(
          attachments.map(async (attachment) => {
            setAttachments((current) =>
              current.map((item) =>
                item.id === attachment.id
                  ? { ...item, status: 'uploading', progress: 0, error: null }
                  : item
              )
            );

            try {
              const url = await uploadPhotoWithRetry(
                attachment,
                ticketId,
                (progress) => {
                  setAttachments((current) =>
                    current.map((item) =>
                      item.id === attachment.id ? { ...item, progress, status: 'uploading' } : item
                    )
                  );
                }
              );

              setAttachments((current) =>
                current.map((item) =>
                  item.id === attachment.id
                    ? { ...item, progress: 100, status: 'uploaded', error: null }
                    : item
                )
              );

              return { url, fileName: attachment.file.name };
            } catch (error: any) {
              const errorMessage = mapUploadErrorMessage(error);
              setAttachments((current) =>
                current.map((item) =>
                  item.id === attachment.id
                    ? { ...item, status: 'failed', error: errorMessage }
                    : item
                )
              );
              throw { error, fileName: attachment.file.name, message: errorMessage };
            }
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            urls.push(result.value.url);
          } else {
            failedUploads.push(`${result.reason.fileName || 'archivo'} (${result.reason.message || 'error'})`);
            const error = result.reason.error;
            if (error?.code === 'storage/unauthorized') {
              const permissionError = new StoragePermissionError({
                path: error.customData?.['path'] || orgStoragePath(scopedOrganizationId, 'tickets', ticketId),
                operation: 'write',
              });
              errorEmitter.emit('permission-error', permissionError);
            }
          }
        }

        if (failedUploads.length > 0) {
          await Promise.allSettled([deleteDoc(uploadSessionRef)]);
          setSubmitWarning(`No se creó la incidencia. Corrige o quita los adjuntos con error y reintenta: ${failedUploads.join(', ')}.`);
          toast({
            variant: 'destructive',
            title: 'Falló la subida de adjuntos',
            description: 'La incidencia no se creó. Revisa el error por archivo y reintenta.',
          });
          return;
        }
      }

      const docData: any = {
        ...data,
        locationId: data.locationId,
        type: 'correctivo' as const,
        status: 'new' as const,
        createdBy: scopedUser.uid,
        createdByName,
        assignedRole: 'mantenimiento',
        assignedTo: null,
        organizationId: scopedOrganizationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        photoUrls: urls,
        hasAttachments: urls.length > 0,
        displayId: `INC-${new Date().getFullYear()}-${String(new Date().getTime()).slice(-4)}`,
      };

      if (!docData.assetId) {
        delete docData.assetId;
      }

      await setDoc(ticketRef, docData);
      if (attachments.length > 0) {
        await Promise.allSettled([deleteDoc(uploadSessionRef)]);
      }

      onSuccess?.({ title: data.title });
      form.reset();
      setAttachments((current) => {
        current.forEach((attachment) => {
          if (attachment.previewUrl) {
            URL.revokeObjectURL(attachment.previewUrl);
          }
        });
        return [];
      });
    } catch (error: any) {
      if (error.code === 'storage/unauthorized') {
        const permissionError = new StoragePermissionError({
          path: error.customData?.['path'] || orgStoragePath(organizationId!, 'tickets', 'photos'),
          operation: 'write',
        });
        return [];
      });
    } catch (error: any) {
      if (error.code === 'permission-denied') {
        const permissionError = new FirestorePermissionError({
          path: orgCollectionPath(organizationId!, 'tickets'),
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
      if (uploadSessionRefLocal) {
        await Promise.allSettled([deleteDoc(uploadSessionRefLocal)]);
      }
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
        {submitWarning && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">{submitWarning}</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{attachments.length} archivo(s) seleccionado(s).</div>
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="rounded-md border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{attachment.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(attachment.file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                    {!isPending && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeAttachment(attachment.id)}>
                        Quitar
                      </Button>
                    )}
                  </div>
                  {attachment.previewUrl && (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      className="mt-2 h-24 w-24 rounded object-cover"
                    />
                  )}
                  {isPending && (
                    <div className="mt-2">
                      <div className="h-1.5 w-full rounded bg-muted">
                        <div
                          className="h-1.5 rounded bg-primary transition-all"
                          style={{ width: `${attachment.progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {attachment.status === 'failed'
                          ? attachment.error || 'Error al subir'
                          : attachment.status === 'uploaded'
                            ? 'Subido'
                            : `${attachment.progress}%`}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
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
