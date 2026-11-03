import { describe, expect, it } from "vitest";

import {
  getRipplingJobId,
  getRipplingSlug,
  isRipplingHost,
  parseRipplingBoardTitle,
  parseRipplingCreatedOn,
  ripplingJobUrl,
  ripplingListingUrl,
} from "../rippling";

function page(apiData: unknown): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { apiData } },
  })}</script></html>`;
}

describe("Rippling URL helpers", () => {
  it("reads the board slug and job uuid", () => {
    const url = new URL(
      "https://ats.rippling.com/collieraerospace/jobs/4981b0ba-5b6f-4ebe-95c0-9d1cda036b77"
    );

    expect(isRipplingHost(url)).toBe(true);
    expect(getRipplingSlug(url)).toBe("collieraerospace");
    expect(getRipplingJobId(url)).toBe("4981b0ba-5b6f-4ebe-95c0-9d1cda036b77");
  });

  it("skips a locale prefix before the slug", () => {
    const url = new URL(
      "https://ats.rippling.com/en-GB/moon/jobs/8b81bca7-1a64-4377-8ea8-869aac03080b"
    );

    expect(getRipplingSlug(url)).toBe("moon");
    expect(getRipplingJobId(url)).toBe("8b81bca7-1a64-4377-8ea8-869aac03080b");
  });

  it("builds listing and job URLs", () => {
    expect(ripplingListingUrl("golden")).toBe(
      "https://api.rippling.com/platform/api/ats/v1/board/golden/jobs"
    );
    expect(ripplingJobUrl("golden", "2ba326f7-9259-47df-9f54-bef4ce5c5fb5")).toBe(
      "https://ats.rippling.com/golden/jobs/2ba326f7-9259-47df-9f54-bef4ce5c5fb5"
    );
  });

  it("rejects other hosts and non-job paths", () => {
    expect(isRipplingHost(new URL("https://www.rippling.com/careers"))).toBe(false);
    expect(getRipplingJobId(new URL("https://ats.rippling.com/golden/jobs"))).toBeNull();
  });
});

describe("Rippling page data", () => {
  it("prefers the board company name over a slogan title", () => {
    expect(
      parseRipplingBoardTitle(
        page({ jobBoard: { title: "Dream Big. Build Fast", companyName: "Moon " } })
      )
    ).toBe("Moon");
    expect(parseRipplingBoardTitle(page({ jobBoard: { title: "Collier Aerospace" } }))).toBe(
      "Collier Aerospace"
    );
  });

  it("reads the job posting date", () => {
    expect(
      parseRipplingCreatedOn(page({ jobPost: { createdOn: "2026-09-09T10:30:06.603000-07:00" } }))
    ).toBe("2026-09-09T10:30:06.603000-07:00");
  });

  it("returns null when the page has no Next.js data", () => {
    expect(parseRipplingBoardTitle("<html></html>")).toBeNull();
    expect(parseRipplingCreatedOn(page({ jobPost: {} }))).toBeNull();
  });
});
