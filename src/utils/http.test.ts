import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchHtmlResponse, getSetCookieHeader, isAbortError, isHtmlResponse } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchHtmlResponse", () => {
  it("returns the response metadata and consumed HTML body", async () => {
    const response = new Response("<html>careers</html>", {
      status: 202,
      headers: { "x-request-id": "request-1" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    const result = await fetchHtmlResponse("https://example.com/jobs", {
      headers: { Accept: "text/html" },
    });

    expect(result.html).toBe("<html>careers</html>");
    expect(result.response.status).toBe(202);
    expect(result.response.headers.get("x-request-id")).toBe("request-1");
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/jobs", {
      headers: { Accept: "text/html" },
    });
  });
});

describe("isHtmlResponse", () => {
  it.each([" <!DOCTYPE html>", "\n<html>", "\t<?xml version='1.0'?>"])(
    "recognizes HTML or XML response %s",
    (raw) => {
      expect(isHtmlResponse(raw)).toBe(true);
    }
  );

  it("does not classify JSON as HTML", () => {
    expect(isHtmlResponse('{"data":[]}')).toBe(false);
  });
});

describe("getSetCookieHeader", () => {
  it("uses getSetCookie when the runtime exposes it", () => {
    const response = new Response();

    Object.defineProperty(response.headers, "getSetCookie", {
      value: () => ["session=abc; Path=/; HttpOnly", "locale=en; Path=/"],
    });

    expect(getSetCookieHeader(response)).toBe("session=abc; locale=en");
  });

  it("splits a combined set-cookie header without splitting Expires dates", () => {
    const response = new Response(null, {
      headers: {
        "set-cookie": "session=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT, locale=en; Path=/",
      },
    });

    expect(getSetCookieHeader(response)).toBe("session=abc; locale=en");
  });
});

describe("isAbortError", () => {
  it.each(["AbortError", "TimeoutError"])("recognizes %s", (name) => {
    const error = new Error("stopped");
    error.name = name;

    expect(isAbortError(error)).toBe(true);
  });

  it("rejects unrelated errors and non-errors", () => {
    expect(isAbortError(new Error("failed"))).toBe(false);
    expect(isAbortError({ name: "AbortError" })).toBe(false);
  });
});
