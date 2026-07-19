import { describe, expect, it } from "vitest";

import {
  extractJobPostingFromJsonLd,
  extractRelevantJDWindow,
  isLikelyJDText,
  limitJDText,
} from "./text";

describe("limitJDText", () => {
  it("appends a truncation marker after the configured limit", () => {
    expect(limitJDText("abcdefgh", 5)).toBe("abcde\n\n[TRUNCATED]");
  });
});

describe("isLikelyJDText", () => {
  it("uses caller-provided keywords and minimum length", () => {
    const options = {
      keywords: ["minimum qualifications"],
      minLength: 30,
    };

    expect(isLikelyJDText("Minimum Qualifications: TypeScript", options)).toBe(true);
    expect(isLikelyJDText("Qualifications: TypeScript", options)).toBe(false);
    expect(isLikelyJDText("Minimum Qualifications", options)).toBe(false);
  });
});

describe("extractRelevantJDWindow", () => {
  it("starts up to 1,000 characters before the earliest configured keyword", () => {
    const text = `${"x".repeat(1_200)}Responsibilities${"y".repeat(200)}`;

    const result = extractRelevantJDWindow(text, {
      keywords: ["responsibilities"],
      maxChars: 250,
    });

    expect(result).toBe(text.slice(200, 450));
  });

  it("uses the beginning of text when no keyword matches", () => {
    expect(
      extractRelevantJDWindow("abcdefgh", {
        keywords: ["qualifications"],
        maxChars: 4,
      })
    ).toBe("abcd");
  });
});

describe("extractJobPostingFromJsonLd", () => {
  const jobPosting = {
    "@type": ["Thing", "JobPosting"],
    title: ["Engineer", "Developer"],
    description: "<p>Build useful software.</p>",
    employmentType: ["FULL_TIME", "CONTRACT"],
    datePosted: "2026-07-19",
    qualifications: "<ul><li>TypeScript</li><li>Testing</li></ul>",
    jobLocation: {
      address: "Remote",
    },
  };

  it("preserves custom fallback semantics by default", () => {
    const result = extractJobPostingFromJsonLd(JSON.stringify(jobPosting));

    expect(result).toContain("Title:\nEngineer, Developer");
    expect(result).toContain("Location:\n\n");
    expect(result).toContain("Description:\nBuild useful software.");
    expect(result).toContain("Qualifications:\n<ul><li>TypeScript</li><li>Testing</li></ul>");
  });

  it("supports iCIMS string addresses and qualification HTML conversion", () => {
    const result = extractJobPostingFromJsonLd(JSON.stringify(jobPosting), {
      allowStringAddress: true,
      convertQualificationsHtml: true,
      normalize: true,
    });

    expect(result).toContain("Location:\nRemote");
    expect(result).toContain("Qualifications:\nTypeScriptTesting");
    expect(result).not.toContain("<li>");
  });

  it("uses the configured separator for string arrays and address fields", () => {
    const raw = JSON.stringify({
      ...jobPosting,
      jobLocation: {
        address: {
          addressLocality: ["Toronto", "Ottawa"],
          addressRegion: "ON",
          addressCountry: "CA",
        },
      },
    });

    const result = extractJobPostingFromJsonLd(raw, {
      arraySeparator: " / ",
      normalize: true,
    });

    expect(result).toContain("Title:\nEngineer / Developer");
    expect(result).toContain("Location:\nToronto / Ottawa, ON, CA");
    expect(result).toContain("Employment Type:\nFULL_TIME / CONTRACT");
  });

  it("enforces a configured minimum after normalization", () => {
    const raw = JSON.stringify({
      "@type": "JobPosting",
      description: "Short",
    });

    expect(
      extractJobPostingFromJsonLd(raw, {
        minLength: 300,
        normalize: true,
      })
    ).toBeNull();
  });

  it("returns null for invalid JSON and non-job-posting data", () => {
    expect(extractJobPostingFromJsonLd("{")).toBeNull();
    expect(extractJobPostingFromJsonLd(JSON.stringify({ "@type": "Article" }))).toBeNull();
  });
});
