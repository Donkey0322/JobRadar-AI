import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchCustomJDMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/employer/detail", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchCustomJD: fetchCustomJDMock,
  };
});

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: loggerWarnMock, error: vi.fn() },
}));

import { getRawJD } from "../index";

import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/employer/detail";
import { ashbyFetcher } from "@/modules/employer/listing/ashby";
import { customFetcher } from "@/modules/employer/listing/custom";
import { greenhouseFetcher } from "@/modules/employer/listing/greenhouse";

const ashbyJD = vi.spyOn(ashbyFetcher, "fetchJD");
const greenhouseJD = vi.spyOn(greenhouseFetcher, "fetchJD");
const customJD = vi.spyOn(customFetcher, "fetchJD");

const ASHBY_URL =
  "https://jobs.ashbyhq.com/whatnot/928ffdca-b316-40ce-b82b-94b570919bcd/application?embed=true";
const TESLA_URL = "https://www.tesla.com/careers/search/job/281940";
const GREENHOUSE_URL = "https://boards.greenhouse.io/acme/jobs/123";

describe("getRawJD", () => {
  beforeEach(() => {
    ashbyJD.mockReset();
    greenhouseJD.mockReset();
    customJD.mockReset();
    fetchCustomJDMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it("falls back to HTML when an ATS API fetch fails", async () => {
    ashbyJD.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found"),
    });
    fetchCustomJDMock.mockResolvedValue({
      jd: "Software Engineer Intern\n\nResponsibilities\nBuild features.",
      error: JD_FETCH_OK,
    });

    const result = await getRawJD(ASHBY_URL);

    expect(result.jd).toContain("Software Engineer Intern");
    expect(result.error).toEqual(JD_FETCH_OK);
    expect(ashbyJD).toHaveBeenCalledOnce();
    expect(fetchCustomJDMock).toHaveBeenCalledOnce();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: ASHBY_URL,
        ats: "ashby",
        code: HttpStatusCode.NOT_FOUND,
      }),
      "⚠️ ATS JD fetch failed, falling back to HTML"
    );
  });

  it("does not fetch HTML when the ATS API already returned a JD", async () => {
    ashbyJD.mockResolvedValue({
      jd: '{"title":"Software Engineer Intern"}',
      error: JD_FETCH_OK,
    });

    const result = await getRawJD(ASHBY_URL);

    expect(result.jd).toBe('{"title":"Software Engineer Intern"}');
    expect(fetchCustomJDMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it("does not retry HTML for sources that already scrape the job page", async () => {
    customJD.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.FORBIDDEN, "Forbidden"),
    });

    const result = await getRawJD(TESLA_URL);

    expect(result.jd).toBeNull();
    expect(result.error.code).toBe(HttpStatusCode.FORBIDDEN);
    expect(customJD).toHaveBeenCalledOnce();
    expect(fetchCustomJDMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it("returns the HTML error when the fallback also fails", async () => {
    greenhouseJD.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found"),
    });
    fetchCustomJDMock.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.FORBIDDEN, "Forbidden"),
    });

    const result = await getRawJD(GREENHOUSE_URL);

    expect(result.jd).toBeNull();
    expect(result.error.code).toBe(HttpStatusCode.FORBIDDEN);
    expect(greenhouseJD).toHaveBeenCalledOnce();
    expect(fetchCustomJDMock).toHaveBeenCalledOnce();
  });

  it("does not fall back to HTML on a 429 ATS fetch", async () => {
    ashbyJD.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.TOO_MANY_REQUESTS, "Too Many Requests"),
    });

    const result = await getRawJD(ASHBY_URL);

    expect(result.jd).toBeNull();
    expect(result.error.code).toBe(HttpStatusCode.TOO_MANY_REQUESTS);
    expect(fetchCustomJDMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it("does not fall back to HTML on a network error", async () => {
    ashbyJD.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.fetch("socket hang up"),
    });

    const result = await getRawJD(ASHBY_URL);

    expect(result.jd).toBeNull();
    expect(result.error.code).toBe(0);
    expect(fetchCustomJDMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});
