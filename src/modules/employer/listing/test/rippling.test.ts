import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/screening";

vi.mock("@/modules/posting/screening", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return {
    ...actual,
    isTarget: vi.fn((title: string) => /engineer/i.test(title)),
    withinDays: vi.fn((date: unknown) => date === "2026-11-02T10:00:00-07:00"),
  };
});

vi.mock("@/store", () => ({ errorLog: { append: vi.fn() } }));

import type { Company } from "@/types";

import { Board } from "../../employer";
import { ripplingBoard } from "../rippling";

import { toJobKeySet } from "@/modules/ats/job-key";
import { errorLog } from "@/store";

const mockFetch = vi.fn<typeof fetch>();

const company: Company = {
  name: "Collier Aerospace",
  ats: "rippling",
  identifier: "collieraerospace",
  domain: "https://ats.rippling.com",
  page: "https://api.rippling.com/platform/api/ats/v1/board/collieraerospace/jobs",
  urls: [],
};

const NEW_ID = "4981b0ba-5b6f-4ebe-95c0-9d1cda036b77";
const OLD_ID = "b666dbfe-34e5-422f-8879-4d53c0ae1f51";
const KNOWN_ID = "a3ae57de-5925-4f55-a106-812b5069cd19";
const NON_TARGET_ID = "f2dd7c17-0959-4ce4-85ba-b614a5b0ae74";

function jobPage(createdOn: string): Response {
  const data = { props: { pageProps: { apiData: { jobPost: { createdOn } } } } };
  return new Response(
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`
  );
}

function row(uuid: string, name: string, location: string) {
  return {
    uuid,
    name,
    url: `https://ats.rippling.com/collieraerospace/jobs/${uuid}`,
    workLocation: { label: location, id: location },
  };
}

describe("Rippling fetcher", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(errorLog.append).mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("is a stateless singleton on the common contract", () => {
    expect(ripplingBoard).toBeInstanceOf(Board);
    expect(Object.keys(ripplingBoard)).toEqual(["ats"]);
  });

  it("keys companies by board slug and names them from the board page", async () => {
    const url = new URL(`https://ats.rippling.com/en-GB/collieraerospace/jobs/${NEW_ID}`);
    const data = {
      props: { pageProps: { apiData: { jobBoard: { title: "Collier Aerospace" } } } },
    };
    mockFetch.mockResolvedValueOnce(
      new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`)
    );

    expect(ripplingBoard.companyKeyFromUrl(url)).toBe("rippling:collieraerospace");
    await expect(ripplingBoard.formCompany(url)).resolves.toEqual(company);
    expect(String(mockFetch.mock.calls[0][0])).toBe(
      "https://ats.rippling.com/collieraerospace/jobs"
    );
  });

  it("dates only unknown target jobs and keeps the recent ones", async () => {
    const knownKeys = toJobKeySet([`https://ats.rippling.com/collieraerospace/jobs/${KNOWN_ID}`]);

    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url === company.page) {
        return Response.json([
          row(NEW_ID, "Software Engineer Intern", "Newport News, VA"),
          row(NEW_ID, "Software Engineer Intern", "Raleigh, NC"),
          row(OLD_ID, "Software Engineer Intern II", "Raleigh, NC"),
          row(KNOWN_ID, "Software Engineer (Entry Level)", "Newport News, VA"),
          row(NON_TARGET_ID, "Office Manager", "Raleigh, NC"),
        ]);
      }
      if (url.endsWith(NEW_ID)) return jobPage("2026-11-02T10:00:00-07:00");
      if (url.endsWith(OLD_ID)) return jobPage("2026-09-01T10:00:00-07:00");
      throw new Error(`unexpected fetch ${url}`);
    });

    const jobs = await ripplingBoard.fetch(company, knownKeys, AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Collier Aerospace",
        role: "Software Engineer Intern",
        link: `https://ats.rippling.com/collieraerospace/jobs/${NEW_ID}`,
        location: "Newport News, VA; Raleigh, NC",
      },
    ]);
    expect(mockFetch.mock.calls.map(([input]) => String(input)).sort()).toEqual(
      [
        company.page,
        `https://ats.rippling.com/collieraerospace/jobs/${NEW_ID}`,
        `https://ats.rippling.com/collieraerospace/jobs/${OLD_ID}`,
      ].sort()
    );
  });

  it("lists every posting key for liveness checks", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json([row(NEW_ID, "Software Engineer Intern", "Raleigh, NC")])
    );

    await expect(ripplingBoard.listJobKeys(company, AbortSignal.timeout(1000))).resolves.toEqual(
      new Set([`rippling:${NEW_ID}`])
    );
  });

  it("returns nothing when the board is missing", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 404, statusText: "Not Found" }));

    await expect(
      ripplingBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(errorLog.append).toHaveBeenCalledWith("Rippling: Collier Aerospace - 404 - Not Found");
  });

  it("keeps the dated job when another posting date is missing", async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url === company.page) {
        return Response.json([
          row(NEW_ID, "Software Engineer Intern", "Raleigh, NC"),
          row(OLD_ID, "Software Engineer", "Raleigh, NC"),
        ]);
      }
      if (url.endsWith(NEW_ID)) return jobPage("2026-11-02T10:00:00-07:00");
      if (url.endsWith(OLD_ID)) return new Response("missing", { status: 404 });
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(
      ripplingBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([
      {
        company: "Collier Aerospace",
        role: "Software Engineer Intern",
        link: `https://ats.rippling.com/collieraerospace/jobs/${NEW_ID}`,
        location: "Raleigh, NC",
      },
    ]);
    expect(errorLog.append).toHaveBeenCalledWith(
      "Rippling: Collier Aerospace - no posting date for 1/2 jobs"
    );
  });
});
