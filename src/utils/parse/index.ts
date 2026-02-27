import type { Job, Source } from "@/types";

import parseHtml from "./html";
import parseMarkdown from "./markdown";

export async function getSource(url: string): Promise<string> {
  // use fetch instead of axios
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (JD-Analyzer; +https://example.local)" },
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch text from ${url}`);
  }
  const text = await resp.text();
  return text;
}

async function parseSource(source: Source): Promise<Job[]> {
  const text = await getSource(source.url);
  switch (source.format) {
    case "markdown":
      return parseMarkdown(text);
    case "html":
      return parseHtml(text, source);
    default:
      source.format satisfies never;
      throw new Error(`Unsupported format: ${source.format}`);
  }
}

export default parseSource;
