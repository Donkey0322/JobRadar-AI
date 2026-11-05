import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/screening";

vi.mock("@/modules/posting/screening", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return {
    ...actual,
    isTarget: vi.fn((title: string) => /engineer/i.test(title)),
    withinDays: vi.fn((date: unknown) => String(date).startsWith("2026-11-02")),
  };
});

const appendErrorLog = vi.hoisted(() => vi.fn());
vi.mock("@/store", () => ({ errorLog: { append: appendErrorLog } }));

import type { Company } from "@/types";

import { Board } from "../../employer";
import { jazzHRBoard } from "../jazzhr";

import { toJobKeySet } from "@/modules/ats/job-key";

const mockFetch = vi.fn<typeof fetch>();

const company: Company = {
  name: "Innovative Systems",
  ats: "jazzhr",
  identifier: "career.innovativesystems.com",
  domain: "https://career.innovativesystems.com",
  page: "https://career.innovativesystems.com/apply/jobs",
  urls: [],
};

function row(timestamp: string, id: string, title: string, location: string): string {
  return `<tr id="row_job_${timestamp}_ABCDEFGHIJKLMNOP">
    <td><a class="job_title_link" href="/apply/jobs/details/${id}?&">${title}</a></td>
    <td> ${location} </td>
  </tr>`;
}

function listing(rows: string): Response {
  return new Response(`<html><head>
    <script type="application/ld+json">{"@type":"Organization","name":"Innovative Systems"}</script>
    </head><body><table id="jobs_table"><tbody>${rows}</tbody></table></body></html>`);
}

describe("JazzHR fetcher", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    appendErrorLog.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("is a stateless singleton on the common contract", () => {
    expect(jazzHRBoard).toBeInstanceOf(Board);
    expect(Object.keys(jazzHRBoard)).toEqual(["ats"]);
  });

  it("forms a company from a job URL and names it from the board", async () => {
    const url = new URL(
      "https://career.innovativesystems.com/apply/jA6qmBJarn/Application-Support-Analyst-EMEA"
    );
    mockFetch.mockResolvedValueOnce(listing(""));

    expect(jazzHRBoard.companyKeyFromUrl(url)).toBe("jazzhr:career.innovativesystems.com");
    await expect(jazzHRBoard.formCompany(url)).resolves.toEqual(company);
    expect(String(mockFetch.mock.calls[0][0])).toBe(company.page);
  });

  it("falls back to the applytojob subdomain when the board cannot be read", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));

    await expect(
      jazzHRBoard.formCompany(new URL("https://neboagency.applytojob.com/apply/AFMqe9Jb7b/x"))
    ).resolves.toMatchObject({ name: "neboagency", identifier: "neboagency.applytojob.com" });
  });

  it("returns recent unknown target jobs from the board table", async () => {
    const knownKeys = toJobKeySet([
      "https://career.innovativesystems.com/apply/Known12345/Software-Engineer",
    ]);
    mockFetch.mockResolvedValueOnce(
      listing(
        row("20261102120000", "nPMqeNSQOo", "Software Engineering Intern", "Pittsburgh, PA") +
          row("20261102120000", "Known12345", "Software Engineer", "Pittsburgh, PA") +
          row("20260522003912", "jA6qmBJarn", "Support Engineer", "London, United Kingdom") +
          row("20261102120000", "Q5oZAaGKNc", "Marketing Coordinator", "Pittsburgh, PA")
      )
    );

    await expect(
      jazzHRBoard.fetch(company, knownKeys, AbortSignal.timeout(1000))
    ).resolves.toEqual([
      {
        company: "Innovative Systems",
        role: "Software Engineering Intern",
        link: "https://career.innovativesystems.com/apply/nPMqeNSQOo",
        location: "Pittsburgh, PA",
      },
    ]);
  });

  it("lists every board job key for liveness checks", async () => {
    mockFetch.mockResolvedValueOnce(
      listing(row("20260522003912", "jA6qmBJarn", "Support Analyst", "London"))
    );

    await expect(jazzHRBoard.listJobKeys(company, AbortSignal.timeout(1000))).resolves.toEqual(
      new Set(["jazzhr:career.innovativesystems.com:jA6qmBJarn"])
    );
  });

  it("logs a dead career domain in one line", async () => {
    mockFetch.mockRejectedValueOnce(
      new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND") })
    );

    await expect(
      jazzHRBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(appendErrorLog).toHaveBeenCalledWith(
      "JazzHR: Innovative Systems - getaddrinfo ENOTFOUND"
    );
  });

  it("logs an HTTP failure and returns nothing", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 404, statusText: "Not Found" }));

    await expect(
      jazzHRBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(appendErrorLog).toHaveBeenCalledWith("JazzHR: Innovative Systems - 404 - Not Found");
  });
});
