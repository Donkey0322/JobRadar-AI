import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import type { Company, Job } from "@/types";

import { fetchEmployerJobs } from "../discover";
import { leverBoard } from "../listing/lever";
import { asBoard } from "../registry";

function company(name: string, urls: string[] = []): Company {
  return {
    name,
    ats: "lever",
    identifier: name,
    domain: "https://jobs.lever.co",
    page: `https://api.lever.co/v0/postings/${name}`,
    urls,
  };
}

describe("fetchEmployerJobs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("converts company URLs to keys before dispatching an adapter", async () => {
    const existing = "https://jobs.lever.co/acme/known";
    const fetch = vi.spyOn(Object.getPrototypeOf(leverBoard), "fetch").mockResolvedValue([]);

    await expect(fetchEmployerJobs([asBoard(company("acme", [existing]))])).resolves.toEqual({
      jobs: [],
      slow: [],
      failed: [],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "acme",
        ats: "lever",
        identifier: "acme",
        urls: [existing],
      }),
      new Set(["lever:known"]),
      expect.any(AbortSignal)
    );
  });

  it("returns jobs from companies that succeed when another company throws", async () => {
    const job: Job = {
      company: "acme",
      role: "Engineer",
      link: "https://jobs.lever.co/acme/new",
      location: "Remote",
    };
    vi.spyOn(Object.getPrototypeOf(leverBoard), "fetch").mockImplementation(async (employer) => {
      if ((employer as Company).name === "bad") {
        throw new Error("down");
      }

      return [job];
    });

    const result = await fetchEmployerJobs([
      asBoard(company("acme")),
      asBoard(company("bad")),
    ]);

    expect(result.jobs).toEqual([job]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        company: "bad",
        ats: "lever",
        error: expect.any(Error),
      }),
    ]);
  });
});
