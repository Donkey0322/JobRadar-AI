export function toBulletList(values: readonly string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}

export function buildPrompt(template: string, variables: Record<string, string>): string {
  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`@@${key}@@`, value);
  }
  const unresolvedVariables = template.match(/@@\w+@@/g);

  if (unresolvedVariables) {
    throw new Error(`Unresolved prompt variables: ${unresolvedVariables.join(", ")}`);
  }

  return template;
}
