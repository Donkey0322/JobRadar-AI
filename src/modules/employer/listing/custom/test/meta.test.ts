import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/titles";

vi.mock("@/modules/posting/titles", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return { ...actual, isTarget: vi.fn((title: string) => /engineer/i.test(title)) };
});

vi.mock("@/utils/data", () => ({ appendErrorLog: vi.fn() }));

import { fetchMeta, MetaCompany } from "../meta";

const mockFetch = vi.fn<typeof fetch>();

function sessionPage(html = `<html><script>["LSD",[],{"token":"abc"}]</script></html>`) {
  const headers = new Headers();
  headers.append("set-cookie", "datr=d1; Path=/; Secure");
  headers.append("set-cookie", "wd=w1; Path=/");
  return new Response(html, { status: 200, headers });
}

const SEARCH = {
  data: {
    job_search_with_featured_jobs: {
      all_jobs: [
        { id: "111", title: "Software Engineer Intern", locations: ["Menlo Park, CA", "Remote"] },
        { title: "Software Engineer, no id" },
        { id: "222", title: "Recruiter", locations: ["New York, NY"] },
      ],
    },
  },
};

describe("fetchMeta", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("bootstraps a session and posts the job search query", async () => {
    mockFetch
      .mockResolvedValueOnce(sessionPage())
      .mockResolvedValueOnce(new Response(`for (;;);${JSON.stringify(SEARCH)}`));
    const signal = AbortSignal.timeout(1000);

    const jobs = await fetchMeta(MetaCompany, new Set(), signal);

    expect(jobs).toEqual([
      {
        company: "Meta",
        role: "Software Engineer Intern",
        link: "https://www.metacareers.com/profile/job_details/111",
        location: "Menlo Park, CA, Remote",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0]).toEqual([
      "https://www.metacareers.com/jobsearch",
      { headers: { "user-agent": "Mozilla/5.0", accept: "text/html" }, signal },
    ]);

    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("https://www.metacareers.com/api/graphql/");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBe(signal);
    expect(Object.entries(init?.headers ?? {})).toEqual([
      ["content-type", "application/x-www-form-urlencoded"],
      ["user-agent", "Mozilla/5.0"],
      ["x-fb-lsd", "abc"],
      ["x-asbd-id", "359341"],
      ["origin", "https://www.metacareers.com"],
      ["referer", "https://www.metacareers.com/jobsearch"],
      ["cookie", "datr=d1; wd=w1"],
    ]);
    expect([...new URLSearchParams(String(init?.body))]).toEqual([
      ["av", "0"],
      ["__user", "0"],
      ["__a", "1"],
      ["__req", "3"],
      ["__comet_req", "31"],
      ["lsd", "abc"],
      ["jazoest", "2979899"],
      ["fb_api_caller_class", "RelayModern"],
      ["fb_api_req_friendly_name", "CareersJobSearchResultsDataQuery"],
      ["server_timestamps", "true"],
      [
        "variables",
        JSON.stringify({
          search_input: {
            q: null,
            divisions: [],
            offices: [],
            roles: [],
            leadership_levels: [],
            saved_jobs: [],
            saved_searches: [],
            sub_teams: [],
            teams: [],
            is_leadership: false,
            is_remote_only: false,
            sort_by_new: true,
            results_per_page: null,
          },
          viewasUserID: null,
          isLoggedIn: false,
        }),
      ],
      ["doc_id", "27506805582236862"],
    ]);
  });

  it("reads the token from the lsd form field and omits an empty cookie", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(`<input type="hidden" name="lsd" value="xyz" />`))
      .mockResolvedValueOnce(new Response(JSON.stringify(SEARCH)));

    await expect(fetchMeta(MetaCompany, new Set())).resolves.toHaveLength(1);

    const headers = mockFetch.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headers["x-fb-lsd"]).toBe("xyz");
    expect(headers).not.toHaveProperty("cookie");
  });

  it("stops before GraphQL when the careers page is an error page", async () => {
    mockFetch.mockResolvedValueOnce(
      sessionPage(`<html><title>Error</title>["LSD",[],{"token":"abc"}]</html>`)
    );

    await expect(fetchMeta(MetaCompany, new Set())).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns no jobs when GraphQL answers with HTML", async () => {
    mockFetch
      .mockResolvedValueOnce(sessionPage())
      .mockResolvedValueOnce(new Response("<html>blocked</html>"));

    await expect(fetchMeta(MetaCompany, new Set())).resolves.toEqual([]);
  });
});
