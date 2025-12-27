"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Department, User } from "@/lib/firebase/models";
import type { TaskPriority, TaskStatus } from "@/types/maintenance-task";

export interface TaskFormValues {
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string;
  assignedTo: string;
  location: string;
  category: string;
}

interface TaskFormProps {
  defaultValues: TaskFormValues;
  onSubmit: (values: TaskFormValues) => Promise<void>;
  submitting?: boolean;
  submitLabel?: string;
  errorMessage?: string | null;
  users?: User[];
  departments?: Department[];
}

export function TaskForm({
  defaultValues,
  onSubmit,
  submitting = false,
  submitLabel = "Guardar",
  errorMessage,
  users,
  departments,
}: TaskFormProps) {
  const UNASSIGNED_VALUE = "__unassigned";
  const ALL_DEPARTMENTS_VALUE = "__all";
  const [values, setValues] = useState<TaskFormValues>(defaultValues);
  const [localError, setLocalError] = useState<string | null>(null);

  const userOptions = useMemo(
    () =>
      (users ?? [])
        .filter((user) => user.displayName || user.email)
        .map((user) => ({
          id: user.id,
          label: user.displayName || user.email,
        })),
    [users]
  );

  const departmentOptions = useMemo(
    () =>
      (departments ?? []).map((department) => ({
        id: department.id,
        label: department.name,
      })),
    [departments]
  );

  useEffect(() => {
    setValues(defaultValues);
  }, [defaultValues]);

  const handleChange = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    if (!values.title.trim()) {
      setLocalError("El título es obligatorio");
      return;
    }

    await onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {(localError || errorMessage) && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {localError || errorMessage}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title">Título</Label>
          <Input
            id="title"
            value={values.title}
            onChange={(e) => handleChange("title", e.target.value)}
            placeholder="Sustituir filtro de aire"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Categoría</Label>
          <Input
            id="category"
            value={values.category}
            onChange={(e) => handleChange("category", e.target.value)}
            placeholder="Mecánica, eléctrica, etc."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assignedTo">Asignado a</Label>
          {userOptions.length > 0 ? (
            <Select
              value={values.assignedTo || UNASSIGNED_VALUE}
              onValueChange={(value) =>
                handleChange(
                  "assignedTo",
                  value === UNASSIGNED_VALUE ? "" : value
                )
              }
            >
              <SelectTrigger id="assignedTo">
                <SelectValue placeholder="Selecciona un usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED_VALUE}>Sin asignar</SelectItem>
                {userOptions.map((user) => (
                  <SelectItem key={user.id} value={user.label}>
                    {user.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="assignedTo"
              value={values.assignedTo}
              onChange={(e) => handleChange("assignedTo", e.target.value)}
              placeholder="Nombre o equipo"
            />
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="location">Ubicación</Label>
          {departmentOptions.length > 0 ? (
            <Select
              value={values.location || ALL_DEPARTMENTS_VALUE}
              onValueChange={(value) =>
                handleChange("location", value === ALL_DEPARTMENTS_VALUE ? "" : value)
              }
            >
              <SelectTrigger id="location">
                <SelectValue placeholder="Selecciona un departamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DEPARTMENTS_VALUE}>Todos</SelectItem>
                {departmentOptions.map((department) => (
                  <SelectItem key={department.id} value={department.label}>
                    {department.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="location"
              value={values.location}
              onChange={(e) => handleChange("location", e.target.value)}
              placeholder="Área o activo"
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="status">Estado</Label>
          <Select
            value={values.status}
            onValueChange={(value) => handleChange("status", value as TaskStatus)}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="en_progreso">En progreso</SelectItem>
              <SelectItem value="completada">Completada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="priority">Prioridad</Label>
          <Select
            value={values.priority}
            onValueChange={(value) => handleChange("priority", value as TaskPriority)}
          >
            <SelectTrigger id="priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="media">Media</SelectItem>
              <SelectItem value="baja">Baja</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="dueDate">Fecha límite</Label>
          <Input
            id="dueDate"
            type="date"
            value={values.dueDate}
            onChange={(e) => handleChange("dueDate", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Descripción</Label>
        <Textarea
          id="description"
          value={values.description}
          onChange={(e) => handleChange("description", e.target.value)}
          placeholder="Añade contexto, pasos o checklist"
          rows={5}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Guardando..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
