'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { handleTagSuggestion, type TagFormState } from '@/app/actions';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, Tags, AlertCircle } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { useToast } from '@/hooks/use-toast';

const formSchema = z.object({
  description: z.string().min(10, {
    message: 'La descripción debe tener al menos 10 caracteres.',
  }),
});

function SubmitButton({ isPending }: { isPending: boolean }) {
  return (
    <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
      {isPending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <>
          <Sparkles className="mr-2 h-4 w-4" />
          Sugerir Etiquetas
        </>
      )}
    </Button>
  );
}

function SuggestedTags({ state, isPending }: { state: TagFormState, isPending: boolean }) {
  const { toast } = useToast();

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags /> Etiquetas Sugeridas
          </CardTitle>
          <CardDescription>
            Haz clic en una etiqueta para copiarla. Úsalas para categorizar la tarea.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!state.message) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags /> Etiquetas Sugeridas
        </CardTitle>
        <CardDescription>
          Haz clic en una etiqueta para copiarla. Úsalas para categorizar la tarea.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {state.tags.map((tag, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="cursor-pointer text-sm"
                onClick={() => {
                  navigator.clipboard.writeText(tag);
                  toast({
                    title: "¡Copiado!",
                    description: `Etiqueta "${tag}" copiada al portapapeles.`,
                  });
                }}
              >
                {tag}
              </Badge>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            <p>{state.message || "No se sugirieron etiquetas."}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SmartTaggingForm() {
  const initialState: TagFormState = { message: '', tags: [] };
  const [state, setState] = useState<TagFormState>(initialState);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: '',
    },
  });
  
  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const formData = new FormData();
    formData.append('description', data.description);

    startTransition(async () => {
      const result = await handleTagSuggestion(state, formData);
      setState(result);
      if (result.errors?.description) {
        form.setError('description', { message: result.errors.description.join(', ') });
      }
      if (result.message && result.message !== 'Éxito' && !result.errors) {
         toast({
          variant: "destructive",
          title: "Error",
          description: result.message,
        });
      }
    });
  }

  return (
    <div className="grid gap-6">
       <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle>Nueva Tarea de Mantenimiento</CardTitle>
              <CardDescription>
                Describe la tarea y nuestra IA sugerirá etiquetas relevantes para mantener tu trabajo organizado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descripción de la Tarea</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Ej: 'La cinta transportadora principal hace un fuerte ruido de rechinamiento y se ha detenido. Parece una falla del motor o de un rodamiento.'"
                          className="min-h-[120px] resize-y"
                          disabled={isPending}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              
            </CardContent>
            <CardFooter className="flex justify-end">
              <SubmitButton isPending={isPending}/>
            </CardFooter>
          </form>
        </Form>
      </Card>
      <SuggestedTags state={state} isPending={isPending} />
    </div>
  );
}
