import { promises as fs } from "node:fs";
import path from "node:path";

export async function readPromptFile(
  moduleDirectory: string,
  relativePath: string
): Promise<string> {
  return await fs.readFile(path.join(moduleDirectory, relativePath), "utf8");
}

export function toBulletList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

export function buildPrompt(template: string, variables: Record<string, string>): string {
  return template.replace(/@@(\w+)@@/g, (_, key: string) => {
    const value = variables[key];

    if (value === undefined) {
      throw new Error(
        `Missing prompt variable: ${key}. Available variables: ${Object.keys(variables).join(", ")}`
      );
    }

    return value;
  });
}
