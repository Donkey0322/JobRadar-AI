import { describe, expect, it } from "vitest";

import {
  findJibeRedirect,
  getJibeApiUrl,
  getJibeJobLink,
  isJibeUrl,
  jibeCompanyName,
  parseJibeJobs,
} from "../jibe";

describe("jibeCompanyName", () => {
  it("prefers the host override", () => {
    expect(
      jibeCompanyName("Advanced Micro Devices, Inc", new URL("https://careers.amd.com/jobs/1"))
    ).toBe("AMD");
  });

  it("strips the legal suffix from hiring_organization", () => {
    expect(jibeCompanyName("GitHub, Inc.", new URL("https://githubinc.jibeapply.com/jobs/1"))).toBe(
      "GitHub"
    );
    expect(jibeCompanyName(null, new URL("https://githubinc.jibeapply.com/jobs/1"))).toBeNull();
  });
});

describe("isJibeUrl", () => {
  it.each([
    ["https://careers.garmin.com/jobs/18475?icims=1", true],
    ["https://i3-corps.jibeapply.com/jobs/5420?lang=en-us", true],
    ["https://careers.jhuapl.edu/jobs/60115", true],
    ["https://careers.garmin.com/jobs/18475", false],
    ["https://careers-acme.icims.com/jobs/1/engineer/job", false],
  ])("%s → %s", (url, expected) => {
    expect(isJibeUrl(new URL(url))).toBe(expected);
  });
});

describe("findJibeRedirect", () => {
  const portal = new URL("https://careers-akima.icims.com/jobs/search?in_iframe=1");

  it("returns the Jibe site a retired iCIMS portal forwards to", () => {
    const html = "<script>location.href = 'https:\\/\\/careers.akima.com\\/jobs'</script>";

    expect(findJibeRedirect(html, portal)?.toString()).toBe("https://careers.akima.com/jobs");
  });

  it("ignores same-host redirects such as iframe parameter stripping", () => {
    const html = "<script>location.href = '/jobs/search?pr=0'</script>";

    expect(findJibeRedirect(html, portal)).toBeNull();
  });
});

describe("getJibeApiUrl", () => {
  it("requests external jobs newest first", () => {
    const url = new URL(getJibeApiUrl("https://careers.acme.com", 2));

    expect(url.pathname).toBe("/api/jobs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "2",
      limit: "100",
      sortBy: "posted_date",
      descending: "true",
      internal: "false",
    });
  });
});

describe("parseJibeJobs", () => {
  it("returns null for non-Jibe payloads", () => {
    expect(parseJibeJobs({ jobPostings: [] })).toBeNull();
    expect(parseJibeJobs({ jobs: [{ data: { req_id: "1", title: "Engineer" } }] })).toHaveLength(1);
  });
});

describe("getJibeJobLink", () => {
  it("links to the job on the Jibe site in the form job boards use", () => {
    expect(
      getJibeJobLink("https://careers.certara.com", {
        req_id: "2640",
        title: "Software Engineer",
        apply_url: "https://emeacareers-certara.icims.com/jobs/2640/login",
      })
    ).toBe("https://careers.certara.com/jobs/2640?icims=1");
  });

  it("skips jobs not backed by iCIMS", () => {
    const origin = "https://careers.acme.com";

    expect(
      getJibeJobLink(origin, {
        req_id: "1",
        title: "Engineer",
        apply_url: "https://acme.taleo.net/1",
      })
    ).toBeNull();
    expect(getJibeJobLink(origin, { req_id: "1", title: "Engineer" })).toBeNull();
  });
});
