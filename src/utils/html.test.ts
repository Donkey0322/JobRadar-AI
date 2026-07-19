import { describe, expect, it } from "vitest";

import { decodeHtmlEntities, escapeHtml } from "./html";

describe("escapeHtml", () => {
  it("escapes every HTML-sensitive character", () => {
    expect(escapeHtml(`Tom & <button title="Tom's">`)).toBe(
      "Tom &amp; &lt;button title=&quot;Tom&#39;s&quot;&gt;"
    );
  });

  it("does not double-process replacement entities", () => {
    expect(escapeHtml("&<>")).toBe("&amp;&lt;&gt;");
  });

  it("leaves safe text unchanged", () => {
    expect(escapeHtml("Software Engineer — Remote")).toBe("Software Engineer — Remote");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes supported named and numeric entities", () => {
    expect(
      decodeHtmlEntities(
        "&lt;a href=&quot;&#x2F;jobs&#47;1&quot;&gt;Tom &amp; Sam&#39;s&lt;&#47;a&gt;"
      )
    ).toBe(`<a href="/jobs/1">Tom & Sam's</a>`);
  });

  it("normalizes whitespace", () => {
    expect(decodeHtmlEntities("  Software\n\tEngineer  ")).toBe("Software Engineer");
  });
});
