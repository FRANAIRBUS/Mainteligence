"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { db } from "@/lib/firebase"
import { collection, addDoc, serverTimestamp } from "firebase/firestore"
import { useCollection } from "@/lib/firebase/firestore/use-collection"

const taskSchema = z.object({
  title: z.string().min(2, "El título debe tener al menos 2 caracteres"),
  priority: z.enum(["low", "medium", "high"]),
  userId: z.string().min(1, "Debe seleccionar un usuario"),
})

type TaskFormValues = z.infer<typeof taskSchema>

export function TaskForm({ onSuccess }: { onSuccess?: () => void }) {
  const { toast } = useToast()
  const { data: users } = useCollection("users")

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: "",
      priority: "medium",
      userId: "",
    },
  })

  async function onSubmit(values: TaskFormValues) {
    try {
      // GUARDADO EN FIRESTORE (Dispara la función de email)
      await addDoc(collection(db, "tasks"), {
        ...values,
        status: "pending",
        createdAt: serverTimestamp(),
      })

      toast({ title: "Tarea creada", description: "El operario recibirá una notificación." })
      form.reset()
      onSuccess?.()
    } catch (error) {
      toast({ 
        title: "Error", 
        description: "No se pudo guardar la tarea.", 
        variant: "destructive" 
      })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Título de la Tarea</FormLabel>
              <FormControl><Input placeholder="Ej: Revisión motor A1" {...field} /></FormControl>
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
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="low">Baja</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="userId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Asignar a</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder="Seleccionar usuario" /></SelectTrigger></FormControl>
                <SelectContent>
                  {users?.map((user: any) => (
                    <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full">Crear Tarea</Button>
      </form>
    </Form>
  )
}
