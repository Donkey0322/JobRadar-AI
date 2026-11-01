import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCustomJD } from "../index";

import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/posting/jd";

const EXPIRED_DISNEY_JOB =
  "https://jobs.disneycareers.com/job/burbank/forward-deployed-engineer/391/99227453008";
const MOVED_DISNEY_JOB =
  "https://www.disneycareers.com/job/burbank/forward-deployed-engineer/391/99227453008";
const LOCALIZED_DISNEY_JOB =
  "https://www.disneycareers.com/en/job/burbank/forward-deployed-engineer/391/99227453008";

function redirect(location: string) {
  return new Response(null, {
    status: 301,
    statusText: "Moved Permanently",
    headers: { location },
  });
}

function jobPage(title: string, url?: string) {
  const copy = `${title}. Responsibilities. ${"Build and operate production services. ".repeat(20)}`;
  const response = new Response(`<html><body><main>${copy}</main></body></html>`, {
    status: 200,
    statusText: "OK",
  });
  if (url) Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("fetchCustomJD", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a 200 HTML shell with no job description as no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "<html><head></head><body></body></html>",
      })
    );

    const result = await fetchCustomJD("https://example.com/jobs/1");

    expect(result).toEqual({
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    });
    expect(result.error.code).toBe(HttpStatusCode.NOT_FOUND);
  });

  it("treats a page that says the job is no longer available as no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "<html><body><p>This position is no longer available.</p></body></html>",
      })
    );

    const result = await fetchCustomJD("https://example.com/jobs/1");

    expect(result).toEqual({
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    });
  });

  it("reads a job page that stays on the same posting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jobPage("Software Engineer", "https://example.com/jobs/1"))
    );

    const result = await fetchCustomJD("https://example.com/jobs/1");

    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Responsibilities");
  });

  it("treats a redirect onto a different job key as no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jobPage("Careers home", "https://boards.greenhouse.io/databricks")
      )
    );

    const result = await fetchCustomJD("https://boards.greenhouse.io/databricks/jobs/6865704002");

    expect(result).toEqual({
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    });
  });

  it("keeps a redirect that lands on the same job id", async () => {
    const landed = "https://job-boards.greenhouse.io/databricks/jobs/6865704002";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jobPage("Software Engineer", landed)));

    const result = await fetchCustomJD("https://boards.greenhouse.io/databricks/jobs/6865704002");

    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Software Engineer");
  });

  it("reads a Radancy job page that stays on the posting", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jobPage("IP Verification Engineer"));
    vi.stubGlobal("fetch", fetchMock);

    const url = "https://careers.arm.com/job/bengaluru/ip-verification-engineer/33099/99500560928";
    const result = await fetchCustomJD(url);

    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Responsibilities");
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "manual" }));
  });

  it("treats a Radancy host that redirects onto another origin's homepage as no data", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://www.disneycareers.com/"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomJD(EXPIRED_DISNEY_JOB);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    });
  });

  it("follows a Radancy redirect that keeps the same job id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect(`/en/job/burbank/forward-deployed-engineer/391/99227453008`))
      .mockResolvedValueOnce(jobPage("Forward Deployed Engineer"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomJD(MOVED_DISNEY_JOB);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      MOVED_DISNEY_JOB,
      LOCALIZED_DISNEY_JOB,
    ]);
    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Forward Deployed Engineer");
  });

  it("treats a Radancy redirect off the job path as no data", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://www.disneycareers.com/en"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomJD(MOVED_DISNEY_JOB);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    });
  });
});
