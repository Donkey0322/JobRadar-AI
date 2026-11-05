import { beforeEach, describe, expect, it, vi } from "vitest";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/types";

import { logger } from "@/utils/logger";

const appendErrorLog = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/store", () => ({
  errorLog: { append: appendErrorLog },
}));

import { AshbyBoard, ashbyBoard } from "../ashby";

const COMPANY: Company = {
  name: "whatnot",
  ats: "ashby",
  identifier: "whatnot",
  domain: "https://jobs.ashbyhq.com",
  page: "https://api.ashbyhq.com/posting-api/job-board/whatnot",
  urls: [],
};

const RECENT_ID = "928ffdca-b316-40ce-b82b-94b570919bcd";
const OLD_ID = "11111111-1111-1111-1111-111111111111";
const SALES_ID = "22222222-2222-2222-2222-222222222222";

const mockFetch = vi.fn<typeof fetch>();

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

async function operationName(input: Parameters<typeof fetch>[1]): Promise<string | undefined> {
  const body = input?.body;
  if (typeof body !== "string") return undefined;
  return (JSON.parse(body) as { operationName?: string }).operationName;
}

describe("Ashby hosted board fallback", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    appendErrorLog.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("keeps a recent hosted-board job when the posting API is off", async () => {
    const published = new Date().toISOString().slice(0, 10);
    const dated = new Set<string>();

    mockFetch.mockImplementation(async (input, init) => {
      const url = requestUrl(input);

      if (url.includes("/posting-api/")) {
        return new Response(null, { status: 404, statusText: "Not Found" });
      }

      const operation = await operationName(init);

      if (operation === "ApiJobBoardWithTeams") {
        return Response.json({
          data: {
            jobBoard: {
              jobPostings: [
                {
                  id: RECENT_ID,
                  title: "Software Engineer Intern (Summer 2027)",
                  locationName: "San Francisco, CA",
                  secondaryLocations: [{ locationName: "New York, NY" }],
                },
                {
                  id: OLD_ID,
                  title: "Software Engineer Intern (Summer 2026)",
                  locationName: "San Francisco, CA",
                  secondaryLocations: [],
                },
                {
                  id: SALES_ID,
                  title: "Account Executive",
                  locationName: "London, UK",
                  secondaryLocations: [],
                },
              ],
            },
          },
        });
      }

      if (operation === "ApiJobPosting") {
        const variables = JSON.parse(String(init?.body)) as {
          variables: { jobPostingId: string };
        };
        const id = variables.variables.jobPostingId;
        dated.add(id);

        return Response.json({
          data: {
            jobPosting: { publishedDate: id === RECENT_ID ? published : "2020-01-01" },
          },
        });
      }

      throw new Error(`unexpected fetch ${url}`);
    });

    const jobs = await ashbyBoard.fetch(COMPANY, new Set(), AbortSignal.timeout(1000));

    expect(dated).toEqual(new Set([RECENT_ID, OLD_ID]));
    expect(jobs).toEqual([
      {
        company: "Whatnot",
        role: "Software Engineer Intern (Summer 2027)",
        link: `https://jobs.ashbyhq.com/whatnot/${RECENT_ID}`,
        location: "San Francisco, CA; New York, NY",
      },
    ]);
    expect(appendErrorLog).not.toHaveBeenCalled();
  });

  it("uses the posting API when it is available", async () => {
    mockFetch.mockResolvedValue(
      Response.json({
        jobs: [
          {
            id: RECENT_ID,
            title: "Software Engineer Intern (Summer 2027)",
            location: "San Francisco, CA",
            jobUrl: `https://jobs.ashbyhq.com/whatnot/${RECENT_ID}`,
            publishedAt: new Date().toISOString(),
          },
        ],
      })
    );

    const jobs = await ashbyBoard.fetch(COMPANY, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(appendErrorLog).not.toHaveBeenCalled();
  });

  it("skips the publish-date request for a known hosted-board job", async () => {
    const published = new Date().toISOString().slice(0, 10);
    const freshId = "33333333-3333-4333-8333-333333333333";
    const dated = new Set<string>();

    mockFetch.mockImplementation(async (input, init) => {
      const url = requestUrl(input);

      if (url.includes("/posting-api/")) {
        return new Response(null, { status: 404, statusText: "Not Found" });
      }

      const operation = await operationName(init);

      if (operation === "ApiJobBoardWithTeams") {
        return Response.json({
          data: {
            jobBoard: {
              jobPostings: [
                {
                  id: RECENT_ID,
                  title: "Software Engineer Intern (Summer 2027)",
                  locationName: "San Francisco, CA",
                  secondaryLocations: [],
                },
                {
                  id: SALES_ID,
                  title: "Account Executive",
                  locationName: "London, UK",
                  secondaryLocations: [],
                },
                {
                  id: freshId,
                  title: "Platform Engineer Intern",
                  locationName: "New York, NY",
                  secondaryLocations: [],
                },
              ],
            },
          },
        });
      }

      if (operation === "ApiJobPosting") {
        const variables = JSON.parse(String(init?.body)) as {
          variables: { jobPostingId: string };
        };
        dated.add(variables.variables.jobPostingId);
        return Response.json({ data: { jobPosting: { publishedDate: published } } });
      }

      throw new Error(`unexpected fetch ${url}`);
    });

    const jobs = await ashbyBoard.fetch(
      COMPANY,
      new Set([`ashby:${RECENT_ID}`]),
      AbortSignal.timeout(1000)
    );

    expect(dated).toEqual(new Set([freshId]));
    expect(jobs).toEqual([
      {
        company: "Whatnot",
        role: "Platform Engineer Intern",
        link: `https://jobs.ashbyhq.com/whatnot/${freshId}`,
        location: "New York, NY",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("logs when the posting API and the hosted board are both missing", async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url.includes("/posting-api/")) {
        return new Response(null, { status: 404, statusText: "Not Found" });
      }

      return Response.json({ data: { jobBoard: null } });
    });

    const jobs = await ashbyBoard.fetch(COMPANY, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toEqual([]);
    expect(appendErrorLog).toHaveBeenCalledWith("Ashby: whatnot - 404 - Not Found");
  });

  it("lists hosted-board jobs without requesting publish dates", async () => {
    mockFetch.mockImplementation(async (input, init) => {
      const url = requestUrl(input);

      if (url.includes("/posting-api/")) {
        return new Response(null, { status: 404, statusText: "Not Found" });
      }

      if ((await operationName(init)) !== "ApiJobBoardWithTeams") {
        throw new Error(`unexpected fetch ${url}`);
      }

      return Response.json({
        data: {
          jobBoard: {
            jobPostings: [
              {
                id: RECENT_ID,
                title: "Software Engineer Intern (Summer 2027)",
                locationName: "San Francisco, CA",
                secondaryLocations: [],
              },
            ],
          },
        },
      });
    });

    const keys = await new AshbyBoard(COMPANY).listedKeys(AbortSignal.timeout(1000));

    expect(keys).toEqual(new Set([`ashby:${RECENT_ID}`]));
  });

  it("returns nothing when the posting API aborts before the hosted board", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));

    await expect(ashbyBoard.fetch(COMPANY, new Set(), AbortSignal.timeout(1000))).resolves.toEqual(
      []
    );
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      { company: "whatnot", url: COMPANY.page },
      "⚠️ Ashby request aborted"
    );
    expect(error).not.toHaveBeenCalled();
    expect(appendErrorLog).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("logs an unexpected posting API failure and returns nothing", async () => {
    const crash = new Error("boom");
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(crash);

    await expect(ashbyBoard.fetch(COMPANY, new Set(), AbortSignal.timeout(1000))).resolves.toEqual(
      []
    );
    expect(error).toHaveBeenCalledWith(
      { error: crash, company: "whatnot", url: COMPANY.page },
      `${RED_CROSS} Error fetching ashby jobs`
    );

    error.mockRestore();
  });
});
