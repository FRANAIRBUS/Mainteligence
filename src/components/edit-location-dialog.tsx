'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { useFirestore } from '@/lib/firebase';
import type { Site } from '@/lib/firebase/models';
import { FirestorePermissionError } from '@/lib/firebase/errors';
import { errorEmitter } from '@/lib/firebase/error-emitter';

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
    .min(1, { message: 'El código no puede estar vacío.' }),
});

type EditLocationFormValues = z.infer<typeof formSchema>;

interface EditLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: Site | null;
}

export function EditLocationDialog({ open, onOpenChange, site }: EditLocationDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<EditLocationFormValues>({
    resolver: zodResolver(formSchema),
  });
  
  useEffect(() => {
    if (site) {
      form.reset({
        name: site.name || '',
        code: site.code || '',
      });
    }
  }, [site, form]);

  const onSubmit = async (data: EditLocationFormValues) => {
    if (!firestore || !site) {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Firestore no está disponible o no se encontró la ubicación.',
        });
        return;
    }
    setIsPending(true);
    
    const siteRef = doc(firestore, "sites", site.id);
    
    try {
      await updateDoc(siteRef, data);
      toast({
        title: 'Éxito',
        description: `Ubicación '${data.name}' actualizada correctamente.`,
      });
      onOpenChange(false);
    } catch (error: any) {
        if (error.code === 'permission-denied') {
            const permissionError = new FirestorePermissionError({
                path: siteRef.path,
                operation: 'update',
                requestResourceData: data,
            });
            errorEmitter.emit('permission-error', permissionError);
        } else {
            toast({
                variant: 'destructive',
                title: 'Error al actualizar',
                description: error.message || 'No se pudo actualizar la ubicación.',
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
  }
  
  if (!site) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Ubicación</DialogTitle>
          <DialogDescription>
            Modifica los detalles de {site.name}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de la ubicación</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Tienda 1" {...field} />
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
                    <Input placeholder="Ej: t1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
               <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Guardar Cambios
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
