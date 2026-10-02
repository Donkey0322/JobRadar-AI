import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCustomJD } from "../index";

import { JD_FETCH_OK } from "@/modules/ats/detail";

const JOB_URL = "https://www.metacareers.com/profile/job_details/1104959738740874";

const PAGE_HTML = `<html><script>["LSD",[],{"token":"token123"}]</script></html>`;

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
});
