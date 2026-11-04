import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchNetflixJD } from "../netflix";

import { JD_FETCH_OK } from "@/modules/posting/jd";

describe("fetchNetflixJD", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    "https://explore.jobs.netflix.net/careers/job/790301/software-engineer",
    "https://explore.jobs.netflix.net/careers?pid=790301",
  ])("reads the position from the jobs API: %s", async (url) => {
    const data = { id: 790301, name: "Software Engineer" };
    const mockFetch = vi.fn<typeof fetch>(async () => Response.json(data));
    vi.stubGlobal("fetch", mockFetch);
    const signal = AbortSignal.timeout(1000);

    const result = await fetchNetflixJD(url, signal);

    expect(result).toEqual({ jd: JSON.stringify(data), error: JD_FETCH_OK });
    expect(mockFetch.mock.calls).toEqual([
      [
        "https://explore.jobs.netflix.net/api/apply/v2/jobs/790301",
        { signal, headers: { Accept: "application/json" } },
      ],
    ]);
  });
});
