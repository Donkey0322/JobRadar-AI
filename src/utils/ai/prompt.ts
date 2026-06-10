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
