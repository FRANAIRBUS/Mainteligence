"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { collection, addDoc, serverTimestamp } from "firebase/firestore"
import { useCollection } from "@/lib/firebase/firestore/use-collection"
import { useFirestore, useUser } from "@/lib/firebase"
import type { User } from "@/lib/firebase/models"
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization"

interface AddIncidentDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AddIncidentDialog({ open, onOpenChange }: AddIncidentDialogProps) {
  const { toast } = useToast()
  const firestore = useFirestore()
  const { user, organizationId } = useUser()
  const { data: users } = useCollection<User>("users")

  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = open !== undefined || onOpenChange !== undefined
  const dialogOpen = useMemo(() => open ?? internalOpen, [open, internalOpen])
  const setDialogOpen = onOpenChange ?? setInternalOpen
  const [assignedTo, setAssignedTo] = useState("")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const title = formData.get("title")?.toString().trim() ?? ""
    const description = formData.get("description")?.toString().trim() ?? ""

    if (!firestore) {
      toast({ title: "Error", description: "Firestore no está disponible.", variant: "destructive" })
      return
    }

    if (!user) {
      toast({ title: "Inicia sesión", description: "Debes iniciar sesión para crear incidencias.", variant: "destructive" })
      return
    }

    if (!organizationId) {
      throw new Error("Critical: Missing organizationId in transaction")
    }

    if (!assignedTo) {
      toast({ title: "Asignar responsable", description: "Selecciona un responsable.", variant: "destructive" })
      return
    }

    try {
      await addDoc(collection(firestore, "tickets"), {
        title,
        description,
        assignedTo,
        status: "open",
        organizationId: DEFAULT_ORGANIZATION_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
        organizationId,
      })

      toast({ title: "Incidencia reportada", description: "Se ha enviado aviso al responsable." })
      setAssignedTo("")
      setDialogOpen(false)
      event.currentTarget.reset()
    } catch (error) {
      toast({ title: "Error", description: "No se pudo reportar.", variant: "destructive" })
    }
  }

  const shouldRenderTrigger = !isControlled

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {shouldRenderTrigger && (
        <DialogTrigger asChild>
          <Button>Nueva Incidencia</Button>
        </DialogTrigger>
      )}
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
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                {users?.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.displayName || user.email}</SelectItem>
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
