"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { db } from "@/lib/firebase"
import { collection, addDoc, serverTimestamp } from "firebase/firestore"
import { useCollection } from "@/lib/firebase/firestore/use-collection"

export function AddIncidentDialog() {
  const [open, setOpen] = useState(false)
  const { toast } = useToast()
  const { data: users } = useCollection("users")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    
    try {
      await addDoc(collection(db, "tickets"), {
        title: formData.get("title"),
        description: formData.get("description"),
        assignedTo: formData.get("assignedTo"),
        status: "open",
        createdAt: serverTimestamp(),
      })

      toast({ title: "Incidencia reportada", description: "Se ha enviado aviso al responsable." })
      setOpen(false)
    } catch (error) {
      toast({ title: "Error", description: "No se pudo reportar.", variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Nueva Incidencia</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Reportar Incidencia</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea id="description" name="description" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assignedTo">Asignar Responsable</Label>
            <Select name="assignedTo" required>
              <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                {users?.map((user: any) => (
                  <SelectItem key={user.id} value={user.id}>{user.name || user.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full">Enviar Reporte</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
