import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fetchPostingJD } from "../raw";

import { HttpStatusCode, NETWORK_ERROR_CODE } from "@/modules/posting/jd";

const PAGE = "https://boards.greenhouse.io/acme/jobs/503";
const JOB_HTML = `<!doctype html><html><body><script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","description":"Build the platform and own the service."}</script></body></html>`;

function response(status: number, body: string, statusText: string) {
  return new Response(body, {
    status,
    statusText,
    headers: { "content-type": status === 200 ? "text/html" : "application/json" },
  });
}

describe("fetchPostingJD status fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [503, "Service Unavailable"],
    [500, "Internal Server Error"],
    [408, "Request Timeout"],
  ])("reads the HTML JD when the Greenhouse API returns %s", async (status, statusText) => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("boards-api.greenhouse.io")) return response(status, "", statusText);
        return response(200, JOB_HTML, "OK");
      })
    );

    const result = await fetchPostingJD(PAGE, AbortSignal.timeout(1000));

    expect(result.jd).toContain("Build the platform and own the service.");
    expect(result.error.code).toBe(HttpStatusCode.OK);
    expect(calls.map((url) => new URL(url).host)).toEqual([
      "boards-api.greenhouse.io",
      "boards.greenhouse.io",
    ]);
  });

  it("returns a 429 without requesting the HTML page", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return response(429, "", "Too Many Requests");
      })
    );

    const result = await fetchPostingJD(PAGE, AbortSignal.timeout(1000));

    expect(result.jd).toBeNull();
    expect(result.error.code).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("boards-api.greenhouse.io");
  });

  it("returns a network error without requesting the HTML page", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        throw new TypeError("socket hang up");
      })
    );

    const result = await fetchPostingJD(PAGE, AbortSignal.timeout(1000));

    expect(result.jd).toBeNull();
    expect(result.error.code).toBe(NETWORK_ERROR_CODE);
    expect(calls).toHaveLength(1);
  });
});
