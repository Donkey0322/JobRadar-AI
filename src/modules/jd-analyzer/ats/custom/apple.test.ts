import { describe, expect, it } from "vitest";

import { extractAppleJD } from "./apple";

function createApplePage(jobsData: Record<string, unknown>): string {
  const serialized = JSON.stringify({ jobsData });
  return `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(serialized)})</script>`;
}

describe("extractAppleJD", () => {
  it("normalizes whitespace when converting posting HTML to text", () => {
    const html = createApplePage({
      postingTitle: "Software Engineer",
      jobSummary: "<p> Build   products\n with care. </p>",
      description: "<div>Design\tand ship.</div>",
    });

    const result = extractAppleJD(html);

    expect(result).toContain("Summary:\nBuild products with care.");
    expect(result).toContain("Description:\nDesign and ship.");
  });
});
