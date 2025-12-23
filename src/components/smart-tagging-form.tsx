'use client';

import { useEffect, useActionState } from 'react';
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
    message: 'Description must be at least 10 characters.',
  }),
});

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <Sparkles />
      )}
      Suggest Tags
    </Button>
  );
}

function SuggestedTags({ state, pending }: { state: FormState, pending: boolean }) {
  const { toast } = useToast();

  if (!pending && !state.timestamp) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags /> Suggested Tags
        </CardTitle>
        <CardDescription>
          Click on a tag to copy it. Use these to categorize the task.
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
                    title: "Copied!",
                    description: `Tag "${tag}" copied to clipboard.`,
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
            <p>No tags were suggested. Please try a more detailed description.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SmartTaggingFormContent() {
  const initialState: FormState = { message: '', tags: [] };
  const [state, formAction] = useActionState(handleTagSuggestion, initialState);
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
                formAction(formData);
              }
            });
          }}
        >
          <CardHeader>
            <CardTitle>New Maintenance Task</CardTitle>
            <CardDescription>
              Describe the task and our AI will suggest relevant tags to keep your work organized.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Task Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g., 'The main conveyor belt is making a loud grinding noise and has stopped moving. Seems like a motor or bearing failure.'"
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
  // This component now wraps the form content in a way that is more stable across server/client renders.
  return <SmartTaggingFormContent />;
}