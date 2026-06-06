import { promises as fs } from "fs";
import path from "path";

export const readSpec = async (): Promise<string> => {
  return await fs.readFile(path.join(import.meta.dirname, "spec.txt"), "utf8");
};

export function toBulletList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

export async function loadPrompt(variables: Record<string, string>): Promise<string> {
  let template = await readSpec();

  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`@@${key}@@`, value);
  }
  const unresolvedVariables = template.match(/@@\w+@@/g);

  if (unresolvedVariables) {
    throw new Error(`Unresolved prompt variables: ${unresolvedVariables.join(", ")}`);
  }

  return template;
}
