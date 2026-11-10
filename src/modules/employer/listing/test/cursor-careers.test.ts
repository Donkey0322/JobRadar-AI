import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Company } from "@/types";

import { logger } from "@/utils/logger";

vi.mock("@/store", () => ({
  errorLog: { append: vi.fn(async () => {}) },
}));

import { asBoard } from "../../registry";
import { AshbyBoard } from "../ashby";
import { CursorAshbyBoard } from "../cursor";

const NEW_GRAD_ID = "164e27cd-289e-4bcd-8aaf-5280e75c5ed6";

const CURSOR: Company = {
  name: "cursor",
  ats: "ashby",
  identifier: "cursor",
  domain: "https://jobs.ashbyhq.com",
  page: "https://api.ashbyhq.com/posting-api/job-board/cursor",
  urls: [],
};

const mockFetch = vi.fn<typeof fetch>();

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

function careersHtml(id: string, slug: string): string {
  return `\\"id\\":\\"${id}\\",\\"title\\":\\"Software Engineer, New Grad 2027\\",\\"urlSlug\\":\\"${slug}\\"`;
}

describe("Cursor career links", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("uses the Cursor board only for the Cursor Ashby company", () => {
    expect(asBoard(CURSOR)).toBeInstanceOf(CursorAshbyBoard);
    expect(asBoard({ ...CURSOR, name: "whatnot", identifier: "whatnot" })).toBeInstanceOf(
      AshbyBoard
    );
    expect(asBoard({ ...CURSOR, name: "whatnot", identifier: "whatnot" })).not.toBeInstanceOf(
      CursorAshbyBoard
    );
  });

  it("stores the cursor.com careers page and keeps the Ashby job id", async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url.includes("/posting-api/")) {
        return Response.json({
          jobs: [
            {
              id: NEW_GRAD_ID,
              title: "Software Engineer, New Grad 2027",
              location: "San Francisco, CA",
              jobUrl: `https://jobs.ashbyhq.com/cursor/${NEW_GRAD_ID}`,
              publishedAt: new Date().toISOString(),
            },
          ],
        });
      }

      if (url === "https://cursor.com/careers") {
        return new Response(careersHtml(NEW_GRAD_ID, "software-engineer-new-grad-2027"), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }

      throw new Error(`unexpected fetch ${url}`);
    });

    const jobs = await asBoard(CURSOR).fetch(CURSOR, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Cursor",
        role: "Software Engineer, New Grad 2027",
        link: `https://cursor.com/careers/software-engineer-new-grad-2027?ashby_jid=${NEW_GRAD_ID}`,
        location: "San Francisco, CA",
      },
    ]);
  });

  it("keeps the Ashby job URL when the careers page is unavailable", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    mockFetch.mockImplementation(async (input) => {
      const url = requestUrl(input);

      if (url.includes("/posting-api/")) {
        return Response.json({
          jobs: [
            {
              id: NEW_GRAD_ID,
              title: "Software Engineer, New Grad 2027",
              location: "San Francisco, CA",
              jobUrl: `https://jobs.ashbyhq.com/cursor/${NEW_GRAD_ID}`,
              publishedAt: new Date().toISOString(),
            },
          ],
        });
      }

      return new Response(null, { status: 404, statusText: "Not Found" });
    });

    const jobs = await asBoard(CURSOR).fetch(CURSOR, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Cursor",
        role: "Software Engineer, New Grad 2027",
        link: `https://jobs.ashbyhq.com/cursor/${NEW_GRAD_ID}`,
        location: "San Francisco, CA",
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      { company: "cursor", url: "https://cursor.com/careers" },
      "⚠️ Cursor career slugs unavailable"
    );

    warn.mockRestore();
  });
});
