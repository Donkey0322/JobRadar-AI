import { describe, expect, it } from "vitest";

import { escapeRegExp, getHostnameWithoutWww, getSubdomainIdentifier, isValidHttpUrl } from "./url";

describe("URL helpers", () => {
  it("removes only a leading www hostname label", () => {
    expect(getHostnameWithoutWww(new URL("https://www.example.com/jobs"))).toBe("example.com");
    expect(getHostnameWithoutWww(new URL("https://jobs.www.example.com"))).toBe(
      "jobs.www.example.com"
    );
  });

  it("gets the first non-www hostname segment", () => {
    expect(getSubdomainIdentifier(new URL("https://www.acme.example.com/jobs"))).toBe("acme");
    expect(getSubdomainIdentifier(new URL("https://jobs.example.com"))).toBe("jobs");
  });

  it("accepts only absolute HTTP and HTTPS URLs", () => {
    expect(isValidHttpUrl("https://example.com/jobs")).toBe(true);
    expect(isValidHttpUrl("http://localhost:3000/jobs")).toBe(true);
    expect(isValidHttpUrl("ftp://example.com/jobs")).toBe(false);
    expect(isValidHttpUrl("/relative/jobs")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
  });
});

describe("escapeRegExp", () => {
  it("escapes regular expression syntax", () => {
    expect(escapeRegExp("jobs.example.com (US)?")).toBe(String.raw`jobs\.example\.com \(US\)\?`);
  });
});
