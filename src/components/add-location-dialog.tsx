'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { collection, addDoc } from 'firebase/firestore';
import { useFirestore } from '@/lib/firebase';

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

type AddLocationFormValues = z.infer<typeof formSchema>;

interface AddLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddLocationDialog({ open, onOpenChange }: AddLocationDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<AddLocationFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      code: '',
    },
  });

  const onSubmit = async (data: AddLocationFormValues) => {
    if (!firestore) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Firestore no está disponible.',
      });
      return;
    }
    setIsPending(true);
    try {
      await addDoc(collection(firestore, "sites"), data);

      toast({
        title: 'Éxito',
        description: `Ubicación '${data.name}' creada correctamente.`,
      });
      onOpenChange(false);
      form.reset();
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Error al crear la ubicación',
        description: e.message || 'Ocurrió un error inesperado.',
      });
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
          <DialogTitle>Añadir Nueva Ubicación</DialogTitle>
          <DialogDescription>
            Introduce los detalles de la nueva ubicación física.
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
              <Button type="submit" disabled={isPending}>
                {isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Crear Ubicación
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
