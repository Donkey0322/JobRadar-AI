import * as cheerio from "cheerio";

import { cleanText } from "./text";

const HTML_ESCAPE_CHARACTERS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_CHARACTERS[character]);
}

/**
 * Decode common HTML entities and normalize surrounding whitespace.
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#47;", "/")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert the HTML to text by removing the HTML tags and replacing multiple spaces with one space and trimming the text.
 * @example
 * ```ts
 * htmlToText("<p>Hello</p>"); // "Hello"
 * ```
 */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  return cleanText($.root().text());
}
