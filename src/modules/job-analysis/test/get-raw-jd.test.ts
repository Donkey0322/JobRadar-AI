import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAshbyJDMock = vi.hoisted(() => vi.fn());
const fetchCustomJDMock = vi.hoisted(() => vi.fn());
const fetchGreenhouseJDMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ats/detail", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    fetchAshbyJD: fetchAshbyJDMock,
    fetchCustomJD: fetchCustomJDMock,
    fetchGreenhouseJD: fetchGreenhouseJDMock,
  };
});

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: loggerWarnMock, error: vi.fn() },
}));

import { getRawJD } from "../index";

import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/ats/detail";

const ASHBY_URL =
  "https://jobs.ashbyhq.com/whatnot/928ffdca-b316-40ce-b82b-94b570919bcd/application?embed=true";
const TESLA_URL = "https://www.tesla.com/careers/search/job/281940";
const GREENHOUSE_URL = "https://boards.greenhouse.io/acme/jobs/123";

describe("getRawJD", () => {
  beforeEach(() => {
    fetchAshbyJDMock.mockReset();
    fetchCustomJDMock.mockReset();
    fetchGreenhouseJDMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it("falls back to HTML when an ATS API fetch fails", async () => {
    fetchAshbyJDMock.mockResolvedValue({
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
    expect(fetchAshbyJDMock).toHaveBeenCalledOnce();
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
    fetchAshbyJDMock.mockResolvedValue({
      jd: '{"title":"Software Engineer Intern"}',
      error: JD_FETCH_OK,
    });

    const result = await getRawJD(ASHBY_URL);

    expect(result.jd).toBe('{"title":"Software Engineer Intern"}');
    expect(fetchCustomJDMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it("does not retry HTML for sources that already scrape the job page", async () => {
    fetchCustomJDMock.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.FORBIDDEN, "Forbidden"),
    });

    const result = await getRawJD(TESLA_URL);

    expect(result.jd).toBeNull();
    expect(result.error.code).toBe(HttpStatusCode.FORBIDDEN);
    expect(fetchCustomJDMock).toHaveBeenCalledOnce();
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it("returns the HTML error when the fallback also fails", async () => {
    fetchGreenhouseJDMock.mockResolvedValue({
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
    expect(fetchGreenhouseJDMock).toHaveBeenCalledOnce();
    expect(fetchCustomJDMock).toHaveBeenCalledOnce();
  });
});
