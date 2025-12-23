'use server';

import { suggestTags } from '@/ai/flows/smart-tagging-assistant';
import { z } from 'zod';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from '@/lib/firebase/config';
import { revalidatePath } from 'next/cache';

// Note: This is a simplified action. In a real-world scenario, creating users
// would be handled by a secure backend service (e.g., Firebase Functions)
// with proper authentication and authorization checks. The client-side SDK
// is not designed for admin-level user management.
const addUserSchema = z.object({
  displayName: z.string().min(2, { message: "Display name must be at least 2 characters." }),
  email: z.string().email({ message: "Please enter a valid email address." }),
  password: z.string().min(6, { message: "Password must be at least 6 characters." }),
  role: z.enum(['operario', 'mantenimiento', 'admin']),
});

export async function addUserAction(prevState: any, formData: FormData) {
  const validatedFields = addUserSchema.safeParse(
    Object.fromEntries(formData.entries())
  );

  if (!validatedFields.success) {
    return {
      message: 'Invalid form data.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    const { displayName, email, role } = validatedFields.data;
    // This is a placeholder for actual user creation logic.
    // In a real app, you would use the Firebase Admin SDK in a secure environment.
    // For this prototype, we'll add the user to the 'users' collection in Firestore.
    
    // We cannot create a user with password from the client without signing them in.
    // So we will just add the user document to firestore.
    const db = getFirestore(app);
    await addDoc(collection(db, "users"), {
      displayName,
      email,
      role,
      active: true,
      isMaintenanceLead: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    revalidatePath('/users');

    return {
      message: `User ${displayName} created successfully.`,
      user: validatedFields.data,
    };
  } catch (e: any) {
    return {
      message: 'Failed to create user.',
      error: e.message,
    };
  }
}


const tagFormSchema = z.object({
  description: z.string().min(10, { message: "Description must be at least 10 characters." }),
});

export type TagFormState = {
  message: string;
  tags: string[];
  errors?: {
    description?: string[];
  };
  timestamp?: number;
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
