'use server';

import { suggestTags } from '@/ai/flows/smart-tagging-assistant';
import { z } from 'zod';

const formSchema = z.object({
  description: z.string().min(10, { message: "Description must be at least 10 characters." }),
});

export type FormState = {
  message: string;
  tags: string[];
  errors?: {
    description?: string[];
  };
  timestamp?: number;
};

export async function handleTagSuggestion(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {

  const validatedFields = formSchema.safeParse({
    description: formData.get('description'),
  });

  if (!validatedFields.success) {
    return {
      message: 'Invalid form data.',
      tags: [],
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    const result = await suggestTags({
      description: validatedFields.data.description,
    });

    if (!result.tags || result.tags.length === 0) {
      return {
        message: 'No tags were suggested. Please try a more detailed description.',
        tags: [],
        timestamp: Date.now(),
      };
    }
    
    return {
      message: 'Success',
      tags: result.tags,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('Error in handleTagSuggestion:', error);
    return {
      message: 'An unexpected error occurred. Please try again later.',
      tags: [],
    };
  }
}
