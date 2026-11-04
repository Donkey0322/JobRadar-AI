import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  logger: loggerMocks,
}));

import { HttpStatusCode, JD_FETCH_OK } from "../fetch";
import { fetchPostingJD } from "../raw";
import { fetchWorkdayJD } from "../workday";

const RECRUITING_URL =
  "https://wd1.myworkdaysite.com/recruiting/clorox/Clorox/job/Brampton-Ontario--CAN/Data---Analytics-Analyst_JR23400";
const RECRUITING_API_URL =
  "https://wd1.myworkdaysite.com/wday/cxs/clorox/Clorox/job/Brampton-Ontario--CAN/Data---Analytics-Analyst_JR23400";

const LOCALE_URL =
  "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Software-Engineer_R123";
const LOCALE_API_URL =
  "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/external/job/Austin-TX/Software-Engineer_R123";

const PLAIN_URL = "https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Engineer_R456";
const PLAIN_API_URL =
  "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/careers/job/Remote/Engineer_R456";

const JOB_JSON = {
  jobPostingInfo: { title: "Data & Analytics Analyst", jobDescription: "<p>Analyze data.</p>" },
};

const JOB_HTML = `<html><body>
  <h1>Software Engineer</h1>
  <h2>Responsibilities</h2><p>Build reliable services for customers.</p>
  <h2>Qualifications</h2><p>Bachelor's degree in Computer Science.</p>
</body></html>`;

const fetchMock = vi.fn<typeof fetch>();

function requestedUrls() {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

function warnMessages() {
  return loggerMocks.warn.mock.calls.map((args) => args.find((arg) => typeof arg === "string"));
}

function respondWith(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input) => {
    const route = routes[String(input)];
    return route ? route() : new Response("unexpected request", { status: 599 });
  });
}

describe("Workday JD API URL", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    for (const mock of Object.values(loggerMocks)) mock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { name: "myworkdaysite recruiting", url: RECRUITING_URL, apiUrl: RECRUITING_API_URL },
    { name: "myworkdayjobs with a locale", url: LOCALE_URL, apiUrl: LOCALE_API_URL },
    { name: "plain myworkdayjobs", url: PLAIN_URL, apiUrl: PLAIN_API_URL },
  ])("requests the CXS job endpoint for a $name URL", async ({ url, apiUrl }) => {
    respondWith({ [apiUrl]: () => Response.json(JOB_JSON) });

    const result = await fetchWorkdayJD(url);

    expect(requestedUrls()).toEqual([apiUrl]);
    expect(result).toEqual({ jd: JSON.stringify(JOB_JSON), error: JD_FETCH_OK });
  });

  it("gets a recruiting JD from the API without an HTML fallback request", async () => {
    respondWith({ [RECRUITING_API_URL]: () => Response.json(JOB_JSON) });

    const result = await fetchPostingJD(RECRUITING_URL, AbortSignal.timeout(1000));

    expect(requestedUrls()).toEqual([RECRUITING_API_URL]);
    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Data & Analytics Analyst");
    expect(warnMessages()).not.toContain("⚠️ ATS JD fetch failed, falling back to HTML");
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it.each([
    { name: "myworkdaysite recruiting", url: RECRUITING_URL, apiUrl: RECRUITING_API_URL },
    { name: "plain myworkdayjobs", url: PLAIN_URL, apiUrl: PLAIN_API_URL },
  ])("falls back to the job page HTML when the $name API fails", async ({ url, apiUrl }) => {
    respondWith({
      [apiUrl]: () =>
        new Response("{}", { status: HttpStatusCode.UNPROCESSABLE_ENTITY, statusText: "Unprocessable" }),
      [url]: () => new Response(JOB_HTML, { status: 200, headers: { "content-type": "text/html" } }),
    });

    const result = await fetchPostingJD(url, AbortSignal.timeout(1000));

    expect(requestedUrls()).toEqual([apiUrl, url]);
    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Build reliable services for customers.");
    expect(warnMessages()).toContain("⚠️ ATS JD fetch failed, falling back to HTML");
  });
});
