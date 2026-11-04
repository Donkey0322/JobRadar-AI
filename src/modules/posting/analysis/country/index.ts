import { COUNTRIES } from "@/constants";

import { buildPrompt, readPromptFile, toBulletList } from "@/utils/ai/prompt";

export async function getCountryRules(): Promise<string> {
  const template = await readPromptFile(import.meta.dirname, "spec.txt");

  return buildPrompt(template, {
    COUNTRIES: toBulletList(COUNTRIES),
  });
}
