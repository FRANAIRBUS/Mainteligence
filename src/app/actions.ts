'use server';

import { suggestTags } from '@/ai/flows/smart-tagging-assistant';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { initializeFirebase } from '@/lib/firebase/server';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

const tagFormSchema = z.object({
  description: z.string().min(10, { message: "La descripción debe tener al menos 10 caracteres." }),
});

export type TagFormState = {
  message: string;
  tags: string[];
  errors?: {
    description?: string[];
  };
  // No more timestamp
};

export async function handleTagSuggestion(
  prevState: TagFormState,
  formData: FormData
): Promise<TagFormState> {

  const validatedFields = tagFormSchema.safeParse({
    description: formData.get('description'),
  });

  if (!validatedFields.success) {
    return {
      message: 'Datos del formulario no válidos.',
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
        message: 'No se sugirieron etiquetas. Intente con una descripción más detallada.',
        tags: [],
      };
    }
    
    return {
      message: 'Éxito',
      tags: result.tags,
    };
  } catch (error) {
    console.error('Error en handleTagSuggestion:', error);
    return {
      message: 'Ocurrió un error inesperado. Por favor, intente más tarde.',
      tags: [],
    };
  }
}
