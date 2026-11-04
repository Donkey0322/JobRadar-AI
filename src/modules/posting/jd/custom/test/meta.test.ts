import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCustomJD } from "../index";

import { isRetryableJDFetch, JD_FETCH_OK } from "@/modules/posting/jd";

const JOB_URL = "https://www.metacareers.com/profile/job_details/1104959738740874";

const PAGE_HTML = `<html><script>["LSD",[],{"token":"token123"}]</script></html>`;

function pageWithCookie(cookie: string) {
  return new Response(PAGE_HTML, { headers: { "set-cookie": `${cookie}; Path=/` } });
}

const GRAPHQL = {
  data: {
    xcp_requisition_job_description: {
      title: "Software Engineer, Systems",
      locations: [],
      departments: ["Software Engineering"],
      description: JSON.stringify({
        __html: "<span>Build integrity systems.</span>",
      }),
      responsibilities: [{ item: "Design detection systems" }],
      minimum_qualifications: [{ item: "Experience with distributed systems" }],
      preferred_qualifications: [{ item: "Experience with AI tooling" }],
      public_compensation: [
        {
          country_code: "US",
          compensation_amount_minimum: "$183,997/year",
          compensation_amount_maximum: "$257,000/year",
        },
      ],
    },
  },
};

describe("fetchMetaJD", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the job description from Meta GraphQL instead of the HTML shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("/api/graphql")) {
          return new Response(JSON.stringify(GRAPHQL), { status: 200 });
        }

        return new Response(PAGE_HTML, { status: 200 });
      })
    );

    const result = await fetchCustomJD(JOB_URL);

    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Software Engineer, Systems");
    expect(result.jd).toContain("Build integrity systems.");
    expect(result.jd).toContain("Minimum Qualifications:");
    expect(result.jd).toContain("- Experience with distributed systems");
    expect(result.jd).toContain("US: $183,997/year - $257,000/year");
  });

  it("loads a session from the careers page when the job page is not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const target = String(input);

        if (target.includes("/api/graphql")) {
          return new Response(JSON.stringify(GRAPHQL), { status: 200 });
        }

        if (target.includes("/profile/job_details/")) {
          return new Response("not found", { status: 404 });
        }

        return new Response(PAGE_HTML, { status: 200 });
      })
    );

    const result = await fetchCustomJD(JOB_URL);

    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Build integrity systems.");
  });

  it.each([
    {
      session: "job page",
      jobPage: () => pageWithCookie("job=1"),
      referer: JOB_URL,
      cookie: "job=1",
    },
    {
      session: "careers page",
      jobPage: () => new Response("not found", { status: 404 }),
      referer: "https://www.metacareers.com/jobsearch",
      cookie: "careers=1",
    },
  ])("posts the job details query with the $session session", async ({ jobPage, referer, cookie }) => {
    const mockFetch = vi.fn<typeof fetch>(async (input) => {
      const target = String(input);
      if (target.includes("/api/graphql")) {
        return new Response(`for (;;);${JSON.stringify(GRAPHQL)}`);
      }
      if (target.includes("/profile/job_details/")) return jobPage();
      return pageWithCookie("careers=1");
    });
    vi.stubGlobal("fetch", mockFetch);
    const signal = AbortSignal.timeout(1000);

    const result = await fetchCustomJD(JOB_URL, signal);

    expect(result.error).toEqual(JD_FETCH_OK);
    const pageHeaders = { "user-agent": "Mozilla/5.0", accept: "text/html" };
    expect(mockFetch.mock.calls[0]).toEqual([JOB_URL, { signal, headers: pageHeaders }]);

    const [url, init] = mockFetch.mock.calls.at(-1)!;
    expect(url).toBe("https://www.metacareers.com/api/graphql/");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBe(signal);
    expect(Object.entries(init?.headers ?? {})).toEqual([
      ["content-type", "application/x-www-form-urlencoded"],
      ["user-agent", "Mozilla/5.0"],
      ["x-fb-lsd", "token123"],
      ["x-asbd-id", "359341"],
      ["origin", "https://www.metacareers.com"],
      ["referer", referer],
      ["cookie", cookie],
    ]);
    expect([...new URLSearchParams(String(init?.body))]).toEqual([
      ["av", "0"],
      ["__user", "0"],
      ["__a", "1"],
      ["__req", "3"],
      ["__comet_req", "31"],
      ["lsd", "token123"],
      ["jazoest", "2116111107101110495051"],
      ["fb_api_caller_class", "RelayModern"],
      ["fb_api_req_friendly_name", "CandidatePortalJobDetailsViewQuery"],
      ["server_timestamps", "true"],
      [
        "variables",
        JSON.stringify({
          renderLoggedInView: false,
          requisitionID: "1104959738740874",
          viewasUserID: null,
        }),
      ],
      ["doc_id", "27371134039243725"],
    ]);
  });

  it("reads a job description preloaded in the page and skips GraphQL", async () => {
    const html = `<html><script type="application/json">${JSON.stringify({
      require: [{ __bbox: { result: { data: GRAPHQL.data } } }],
    })}</script></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("/api/graphql")) {
          throw new Error("GraphQL should not be called");
        }

        return new Response(html, { status: 200 });
      })
    );

    const result = await fetchCustomJD(JOB_URL);

    expect(result.error).toEqual(JD_FETCH_OK);
    expect(result.jd).toContain("Build integrity systems.");
    expect(result.jd).toContain("Minimum Qualifications:");
  });

  it("treats an HTML GraphQL response as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("/api/graphql")) {
          return new Response("<html>blocked</html>", { status: 200 });
        }

        return new Response(PAGE_HTML, { status: 200 });
      })
    );

    const result = await fetchCustomJD(JOB_URL);

    expect(result.jd).toBeNull();
    expect(isRetryableJDFetch(result.error)).toBe(true);
  });
});
