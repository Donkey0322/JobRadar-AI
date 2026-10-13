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

function jobPage(title: string) {
  const copy = `${title}. Responsibilities. ${"Build and operate production services. ".repeat(20)}`;
  return new Response(`<html><body><main>${copy}</main></body></html>`, {
    status: 200,
    statusText: "OK",
  });
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

  it("reads a Radancy job page that stays on the posting", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jobPage("IP Verification Engineer"));
    vi.stubGlobal("fetch", fetchMock);

    const url = "https://careers.arm.com/job/bengaluru/ip-verification-engineer/33099/99500560928";
    const result = await fetchCustomJD(url);

    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Responsibilities");
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "manual" }));
  });

  it("treats a Radancy host that redirects onto another origin's homepage as the job path there", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.disneycareers.com/"))
      .mockResolvedValueOnce(redirect(`/en/job/burbank/forward-deployed-engineer/391/99227453008`))
      .mockResolvedValueOnce(new Response("missing", { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomJD(EXPIRED_DISNEY_JOB);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      EXPIRED_DISNEY_JOB,
      MOVED_DISNEY_JOB,
      LOCALIZED_DISNEY_JOB,
    ]);
    expect(result).toEqual({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found"),
    });
  });

  it("keeps a Radancy job that is still posted after the host move", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://www.disneycareers.com/"))
      .mockResolvedValueOnce(redirect(`/en/job/burbank/forward-deployed-engineer/391/99227453008`))
      .mockResolvedValueOnce(jobPage("Forward Deployed Engineer"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomJD(EXPIRED_DISNEY_JOB);

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
