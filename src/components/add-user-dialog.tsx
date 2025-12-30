'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useFirestore } from '@/lib/firebase';
import type { Department } from '@/lib/firebase/models';
import { DEFAULT_ORGANIZATION_ID } from '@/lib/organization';
import { errorEmitter } from '@/lib/firebase/error-emitter';
import { FirestorePermissionError } from '@/lib/firebase/errors';

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

const formSchema = z.object({
  displayName: z
    .string()
    .min(2, { message: 'El nombre debe tener al menos 2 caracteres.' }),
  email: z.string().email({ message: 'Por favor, ingrese un correo electrónico válido.' }),
  role: z.enum(['operario', 'mantenimiento', 'admin']),
  departmentId: z.string().optional(),
});

type AddUserFormValues = z.infer<typeof formSchema>;

interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departments?: Department[];
}

export function AddUserDialog({ open, onOpenChange, departments }: AddUserDialogProps) {
  const { toast } = useToast();
  const firestore = useFirestore();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<AddUserFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: '',
      email: '',
      role: 'operario',
    },
  });

  const onSubmit = async (data: AddUserFormValues) => {
    if (!firestore) {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Firestore no está disponible. Por favor, intente de nuevo más tarde.',
        });
        return;
    }
    setIsPending(true);

    const docData = {
      ...data,
      active: true,
      isMaintenanceLead: data.role === 'admin' || data.role === 'mantenimiento', // Default lead status
      organizationId: DEFAULT_ORGANIZATION_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    
    try {
      const collectionRef = collection(firestore, "users");
      await addDoc(collectionRef, docData);
      toast({
          title: 'Éxito',
          description: `Perfil para ${data.displayName} creado. El usuario ahora debe registrarse o iniciar sesión con el email ${data.email}.`,
      });
      onOpenChange(false);
      form.reset();
    } catch (error: any) {
        if (error.code === 'permission-denied') {
          const permissionError = new FirestorePermissionError({
            path: 'users',
            operation: 'create',
            requestResourceData: docData,
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
          <DialogTitle>Añadir Perfil de Usuario</DialogTitle>
          <DialogDescription>
            Crea un perfil con un rol para un nuevo usuario. El usuario deberá registrarse usando este mismo email.
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
                        <SelectItem value="operario">Operario</SelectItem>
                        <SelectItem value="mantenimiento">Mantenimiento</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
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
                          <SelectValue placeholder="Opcional" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">Ninguno</SelectItem>
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
                Crear Perfil
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
