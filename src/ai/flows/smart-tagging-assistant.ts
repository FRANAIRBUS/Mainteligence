'use server';
/**
 * @fileOverview AI-powered tag suggestion flow for maintenance tasks.
 *
 * - suggestTags - A function that suggests relevant tags based on a given task description.
 * - SuggestTagsInput - The input type for the suggestTags function.
 * - SuggestTagsOutput - The return type for the suggestTags function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestTagsInputSchema = z.object({
  description: z
    .string()
    .describe('The description of the maintenance task to be tagged.'),
});
export type SuggestTagsInput = z.infer<typeof SuggestTagsInputSchema>;

const SuggestTagsOutputSchema = z.object({
  tags: z
    .array(z.string())
    .describe('An array of suggested tags for the maintenance task.'),
});
export type SuggestTagsOutput = z.infer<typeof SuggestTagsOutputSchema>;

export async function suggestTags(input: SuggestTagsInput): Promise<SuggestTagsOutput> {
  return suggestTagsFlow(input);
}

const suggestTagsPrompt = ai.definePrompt({
  name: 'suggestTagsPrompt',
  input: {schema: SuggestTagsInputSchema},
  output: {schema: SuggestTagsOutputSchema},
  prompt: `You are an AI assistant specializing in suggesting relevant tags for maintenance tasks.

  Given the following description of a maintenance task, generate an array of tags that would be helpful for categorizing and searching for this task later.

  Description: {{{description}}}

  The tags should be concise and relevant to the task described.
  Return only an array of strings.
  Example: ["electrical", "wiring", "repair", "urgent"]
  `,
});

const suggestTagsFlow = ai.defineFlow(
  {
    name: 'suggestTagsFlow',
    inputSchema: SuggestTagsInputSchema,
    outputSchema: SuggestTagsOutputSchema,
  },
  async input => {
    const {output} = await suggestTagsPrompt(input);
    return output!;
  }
);
