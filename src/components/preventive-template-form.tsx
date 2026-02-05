'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Asset, Department, Site } from '@/lib/firebase/models';
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
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

const scheduleTypes = [
  { value: 'daily', label: 'Diaria' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'date', label: 'Fecha específica' },
] as const;

const statusOptions = [
  { value: 'active', label: 'Activa' },
  { value: 'paused', label: 'Pausada' },
  { value: 'archived', label: 'Archivada' },
] as const;

const priorities = ['Baja', 'Media', 'Alta', 'Crítica'] as const;

const daysOfWeekOptions = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
];

const formSchema = z
  .object({
    name: z.string().min(3, { message: 'El nombre debe tener al menos 3 caracteres.' }),
    description: z.string().optional(),
    status: z.enum(['active', 'paused', 'archived']),
    automatic: z.boolean(),
    scheduleType: z.enum(['daily', 'weekly', 'monthly', 'date']),
    timeOfDay: z.string().optional(),
    daysOfWeek: z.array(z.number()).optional(),
    dayOfMonth: z
      .string()
      .optional()
      .transform((value) => (value ? Number(value) : undefined)),
    date: z.string().optional(),
    priority: z.enum(['Baja', 'Media', 'Alta', 'Crítica']),
    siteId: z.string().optional(),
    departmentId: z.string().optional(),
    assetId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scheduleType === 'weekly') {
      if (!value.daysOfWeek || value.daysOfWeek.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['daysOfWeek'],
          message: 'Selecciona al menos un día.',
        });
      }
    }

    if (value.scheduleType === 'monthly') {
      if (!value.dayOfMonth || Number.isNaN(value.dayOfMonth)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dayOfMonth'],
          message: 'Indica el día del mes.',
        });
      }
    }

    if (value.scheduleType === 'date') {
      if (!value.date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['date'],
          message: 'Selecciona la fecha.',
        });
      }
    }
    if (value.automatic === true && value.status === "active") {
      const siteId = value.siteId && value.siteId !== "__none__" ? value.siteId : undefined;
      const departmentId = value.departmentId && value.departmentId !== "__none__" ? value.departmentId : undefined;
      if (!siteId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["siteId"],
          message: "Selecciona una ubicación para preventivos automáticos activos.",
        });
      }
      if (!departmentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["departmentId"],
          message: "Selecciona un departamento para preventivos automáticos activos.",
        });
      }
    }

  });

export type PreventiveTemplateFormValues = z.infer<typeof formSchema>;

export type PreventiveTemplateFormProps = {
  defaultValues?: Partial<PreventiveTemplateFormValues>;
  onSubmit: (values: PreventiveTemplateFormValues) => Promise<void> | void;
  submitting?: boolean;
  errorMessage?: string | null;
  onCancel?: () => void;
  sites?: Site[];
  departments?: Department[];
  assets?: Asset[];
};

export function PreventiveTemplateForm({
  defaultValues,
  onSubmit,
  submitting = false,
  errorMessage,
  onCancel,
  sites = [],
  departments = [],
  assets = [],
}: PreventiveTemplateFormProps) {
  const form = useForm<PreventiveTemplateFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      status: 'active',
      automatic: true,
      scheduleType: 'monthly',
      timeOfDay: '08:00',
      daysOfWeek: [],
      priority: 'Media',
      siteId: '__none__',
      departmentId: '__none__',
      assetId: '__none__',
      ...defaultValues,
    },
  });

  const selectedScheduleType = form.watch('scheduleType');
  const selectedDaysOfWeek = form.watch('daysOfWeek');
  const selectedDays = useMemo(
    () => new Set(selectedDaysOfWeek ?? []),
    [selectedDaysOfWeek]
  );

  const handleSubmit = async (values: PreventiveTemplateFormValues) => {
    await onSubmit(values);
  };

  return (
    <Form {...form}>
      <form className="space-y-6" onSubmit={form.handleSubmit(handleSubmit)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Nombre de plantilla</FormLabel>
                <FormControl>
                  <Input placeholder="Ej. Inspección mensual de compresores" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Descripción</FormLabel>
                <FormControl>
                  <Textarea placeholder="Describe el alcance de la plantilla" {...field} />
                </FormControl>
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
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona prioridad" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {priorities.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priority}
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
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Estado</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona estado" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {statusOptions.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
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
            name="automatic"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Generación automática</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <span className="text-sm text-muted-foreground">
                    {field.value ? 'Activada' : 'Desactivada'}
                  </span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="scheduleType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Frecuencia</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona frecuencia" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {scheduleTypes.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
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
              name="timeOfDay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hora de ejecución</FormLabel>
                  <FormControl>
                    <Input type="time" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {selectedScheduleType === 'weekly' ? (
            <FormField
              control={form.control}
              name="daysOfWeek"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Días de la semana</FormLabel>
                  <div className="flex flex-wrap gap-3">
                    {daysOfWeekOptions.map((day) => (
                      <label key={day.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedDays.has(day.value)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedDays);
                            if (checked) {
                              next.add(day.value);
                            } else {
                              next.delete(day.value);
                            }
                            field.onChange(Array.from(next));
                          }}
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          {selectedScheduleType === 'monthly' ? (
            <FormField
              control={form.control}
              name="dayOfMonth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Día del mes</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} max={31} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}

          {selectedScheduleType === 'date' ? (
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha específica</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="siteId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ubicación</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? '__none__'}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona ubicación" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">Sin ubicación</SelectItem>
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
                <Select onValueChange={field.onChange} value={field.value ?? '__none__'}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona departamento" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__none__">Sin departamento</SelectItem>
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

          <FormField
            control={form.control}
            name="assetId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Activo</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? '__none__'}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona activo" />
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
        </div>

        {errorMessage ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Guardando…' : 'Crear plantilla'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
