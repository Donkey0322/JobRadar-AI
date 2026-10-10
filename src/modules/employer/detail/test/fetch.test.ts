import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  fetchJD,
  HttpStatusCode,
  isRetryableJDFetch,
  JD_FETCH_ERROR,
  jdFetchErrorFromResponse,
  NETWORK_ERROR_CODE,
  parseRetryAfter,
} from "../fetch";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
  });

  it("caps large Retry-After values", () => {
    expect(parseRetryAfter("3600")).toBe(60_000);
  });

  it("returns undefined for missing or invalid headers", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("isRetryableJDFetch", () => {
  it("retries 429 and network failures only", () => {
    expect(isRetryableJDFetch({ code: HttpStatusCode.TOO_MANY_REQUESTS })).toBe(true);
    expect(isRetryableJDFetch({ code: NETWORK_ERROR_CODE })).toBe(true);
    expect(isRetryableJDFetch({ code: HttpStatusCode.NOT_FOUND })).toBe(false);
  });
});

describe("jdFetchErrorFromResponse", () => {
  it("attaches retryAfterMs for 429 responses", () => {
    const res = new Response(null, {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "retry-after": "8" },
    });

    expect(jdFetchErrorFromResponse(res)).toEqual({
      code: HttpStatusCode.TOO_MANY_REQUESTS,
      desc: "Too Many Requests",
      retryAfterMs: 8000,
    });
  });

  it("omits retryAfterMs for other HTTP errors", () => {
    const res = new Response(null, {
      status: 404,
      statusText: "Not Found",
      headers: { "retry-after": "8" },
    });

    expect(jdFetchErrorFromResponse(res)).toEqual(JD_FETCH_ERROR.http(404, "Not Found"));
  });
});

describe("fetchJD", () => {
  it("includes retryAfterMs when the ATS API returns 429", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "5" },
      })
    );

    const result = await fetchJD("https://example.com/job", AbortSignal.timeout(1000));

    expect(result).toEqual({
      jd: null,
      error: {
        code: HttpStatusCode.TOO_MANY_REQUESTS,
        desc: "Too Many Requests",
        retryAfterMs: 5000,
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith("https://example.com/job", {
      signal: expect.any(AbortSignal),
      headers: { Accept: "application/json" },
    });
  });
});
