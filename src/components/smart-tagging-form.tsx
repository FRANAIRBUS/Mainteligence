'use client';

import { useEffect, useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
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
import { handleTagSuggestion, type FormState } from '@/app/actions';
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? (
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

function SuggestedTags({ state, pending }: { state: FormState, pending: boolean }) {
  const { toast } = useToast();
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if(state.timestamp) {
      setShowResults(true);
    }
  }, [state.timestamp]);

  if (!showResults) {
    return null;
  }

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
        {pending ? (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
        ) : state.tags.length > 0 ? (
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
            <p>No se sugirieron etiquetas. Intenta con una descripción más detallada.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SmartTaggingFormContent({
  formAction,
  initialState,
}: {
  formAction: (payload: FormData) => void;
  initialState: FormState;
}) {
  const [state, action] = useActionState(formAction, initialState);
  const { pending } = useFormStatus();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: '',
    },
  });

  useEffect(() => {
    if (state.message && state.message !== 'Success' && state.message !== 'Invalid form data.') {
      toast({
        variant: "destructive",
        title: "Error",
        description: state.message,
      });
    }
  }, [state, toast]);

  return (
    <div className="grid gap-6">
       <Card>
        <form
          action={(formData) => {
            form.trigger().then((isValid) => {
              if (isValid) {
                action(formData);
              }
            });
          }}
        >
          <CardHeader>
            <CardTitle>Nueva Tarea de Mantenimiento</CardTitle>
            <CardDescription>
              Describe la tarea y nuestra IA sugerirá etiquetas relevantes para mantener tu trabajo organizado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
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
                        disabled={pending}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>
          </CardContent>
          <CardFooter className="flex justify-end">
            <SubmitButton />
          </CardFooter>
        </form>
      </Card>
      <SuggestedTags state={state} pending={pending} />
    </div>
  );
}


export default function SmartTaggingForm() {
  const initialState: FormState = { message: '', tags: [] };
  
  // Wrap the form content to ensure hooks are used correctly.
  return <SmartTaggingFormContent formAction={handleTagSuggestion} initialState={initialState} />;
}
