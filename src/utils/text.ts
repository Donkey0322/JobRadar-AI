export function stringifyResult(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

/**
 * Clean the text by replacing multiple spaces with one space and trimming the text.
 * @example
 * ```ts
 * cleanText("Hello\n\tWorld"); // "Hello World"
 * ```
 */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Normalize the raw text by splitting the text by newline, cleaning the text, and filtering out empty lines.
 * @example
 * ```ts
 * normalizeRawText("Hello\n\tWorld"); // "Hello\nWorld"
 * normalizeRawText("Hello\n\tWorld\n\tHello\n\tWorld"); // "Hello\nWorld\nHello\nWorld"
 * ```
 */
export function normalizeRawText(text: string): string | null {
  const lines = text
    .split("\n") // split by newline
    .map(cleanText) // replace multiple spaces with one space
    .filter((line) => line.length > 0); // filter out empty lines

  return lines.length ? lines.join("\n") : null; // join lines back together
}
