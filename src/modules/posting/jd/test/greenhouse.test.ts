import { afterEach, describe, expect, it, vi } from "vitest";

import { parseGreenhouse } from "../greenhouse";

describe("parseGreenhouse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the board and job id from a Greenhouse job path", async () => {
    await expect(
      parseGreenhouse("https://job-boards.greenhouse.io/acme/jobs/6865704002")
    ).resolves.toEqual({
      company: "acme",
      jobId: "6865704002",
    });
  });

  it("matches a career slug to one Greenhouse job title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: 7964062,
              title: "Algorithm Development (Quant Research & Trading) Internship – Summer 2027",
            },
            {
              id: 8059837,
              title:
                "Algorithm Development (Quant Research & Trading) PhD Internship – Summer 2027",
            },
          ],
        }),
      })
    );

    await expect(
      parseGreenhouse(
        "https://www.hudsonrivertrading.com/hrt-job/algorithm-development-quant-research-trading-phd-internship-summer-2027/"
      )
    ).resolves.toEqual({
      company: "wehrtyou",
      jobId: "8059837",
    });
  });
});
