import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/titles";

vi.mock("@/modules/posting/titles", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return {
    ...actual,
    isTarget: vi.fn((title: string) => /engineer/i.test(title)),
    withinDays: vi.fn((date: unknown) => date === 1_700_000_000),
  };
});

vi.mock("@/utils/data", () => ({ appendErrorLog: vi.fn() }));

import { fetchNetflix, NetflixCompany } from "../netflix";

const mockFetch = vi.fn<typeof fetch>();

function position(id: number, name: string, created: number) {
  return {
    id,
    posting_name: name,
    location: "Los Gatos, California",
    canonicalPositionUrl: `https://explore.jobs.netflix.net/careers/job/${id}`,
    t_create: created,
    t_update: created,
  };
}

describe("fetchNetflix", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("pages the jobs API until a page comes back empty", async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          positions: [
            position(790301, "Software Engineer Intern", 1_700_000_000),
            position(790302, "Software Engineer, old", 1),
          ],
        })
      )
      .mockResolvedValueOnce(Response.json({ positions: [] }));
    const signal = AbortSignal.timeout(1000);

    const jobs = await fetchNetflix(NetflixCompany, new Set(), signal);

    expect(jobs).toEqual([
      {
        company: "Netflix",
        role: "Software Engineer Intern",
        link: "https://explore.jobs.netflix.net/careers/job/790301",
        location: "Los Gatos, California",
      },
    ]);
    expect(mockFetch.mock.calls).toEqual([
      [
        "https://explore.jobs.netflix.net/api/apply/v2/jobs?sort_by=new&num=100",
        { signal, headers: { Accept: "application/json" } },
      ],
      [
        "https://explore.jobs.netflix.net/api/apply/v2/jobs?sort_by=new&num=100&start=100",
        { signal, headers: { Accept: "application/json" } },
      ],
    ]);
  });
});
