import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCustomJD } from "../index";

import { HttpStatusCode, JD_FETCH_ERROR } from "@/modules/ats/detail";

describe("fetchCustomJD", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a 200 HTML shell with no job description as no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "<html><head></head><body></body></html>",
      })
    );

    const result = await fetchCustomJD("https://example.com/jobs/1");

    expect(result).toEqual({
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    });
    expect(result.error.code).toBe(HttpStatusCode.NOT_FOUND);
  });
});
