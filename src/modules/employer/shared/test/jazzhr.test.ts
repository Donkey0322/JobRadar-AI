import { describe, expect, it } from "vitest";

import {
  getJazzHRJobId,
  isJazzHRUrl,
  jazzHRHostName,
  jazzHRJobUrl,
  jazzHRListingUrl,
  jazzHRRowDate,
  parseJazzHRCompanyName,
  parseJazzHRListing,
} from "../jazzhr";

const LISTING = `<html><head>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"Organization","name":"Innovative Systems"}</script>
</head><body>
<table id="job_search_table"><tr><td>search</td></tr></table>
<table id="jobs_table" class="menu_table"><tbody>
  <tr><th>Position</th><th>Location</th></tr>
  <tr id="row_job_20260522003912_6AKOOL63E8HLANVX" class="resumator_even_row">
    <td><a class="job_title_link" href="/apply/jobs/details/jA6qmBJarn?&">Application Support Analyst - EMEA</a>
      <br /><span class="resumator_department">Global Operations</span></td>
    <td> London, United Kingdom </td>
  </tr>
  <tr id="row_job_20260903192931_0RGBZWJN1ATQVRXF" class="resumator_odd_row">
    <td><a class="job_title_link" href="/apply/jobs/details/nPMqeNSQOo?&">Intern/Co-op- Summer 2027 - Software Engineering</a>
      <br /><span class="resumator_department">Engineering</span></td>
    <td> Pittsburgh, PA </td>
  </tr>
</tbody></table>
<div id="mobile"><div id="row_job_20260903192931_0RGBZWJN1ATQVRXF">
  <a class="job_title_link" href="/apply/jobs/details/nPMqeNSQOo?&">duplicate mobile row</a>
</div></div>
</body></html>`;

describe("JazzHR URL classification", () => {
  it.each([
    "https://neboagency.applytojob.com/apply/AFMqe9Jb7b/Web-Development-Intern",
    "https://neboagency.applytojob.com/apply/jobs",
    "https://career.innovativesystems.com/apply/jA6qmBJarn/Application-Support-Analyst-EMEA",
    "https://career.innovativesystems.com/apply/jobs/details/jA6qmBJarn",
    "https://techinsights.applytojob.com/apply/3yhis78252/Software-Development-Coop",
  ])("recognizes %s", (url) => {
    expect(isJazzHRUrl(new URL(url))).toBe(true);
  });

  it.each([
    "https://careers.example.com/apply/internship",
    "https://careers.example.com/apply/jobs",
    "https://jobs.lever.co/acme/123/apply",
  ])("rejects %s", (url) => {
    expect(isJazzHRUrl(new URL(url))).toBe(false);
  });
});

describe("JazzHR URL helpers", () => {
  it("reads job ids and builds board and job URLs", () => {
    const url = new URL(
      "https://career.innovativesystems.com/apply/jA6qmBJarn/Application-Support"
    );

    expect(getJazzHRJobId(url.pathname)).toBe("jA6qmBJarn");
    expect(jazzHRListingUrl(url)).toBe("https://career.innovativesystems.com/apply/jobs");
    expect(jazzHRJobUrl(url.origin, "jA6qmBJarn")).toBe(
      "https://career.innovativesystems.com/apply/jA6qmBJarn"
    );
  });

  it("names companies from the applytojob subdomain or the host", () => {
    expect(jazzHRHostName(new URL("https://neboagency.applytojob.com/apply/jobs"))).toBe(
      "neboagency"
    );
    expect(jazzHRHostName(new URL("https://career.innovativesystems.com/apply/jobs"))).toBe(
      "career.innovativesystems.com"
    );
  });
});

describe("JazzHR listing parsing", () => {
  it("turns the row id timestamp into a date", () => {
    expect(jazzHRRowDate("row_job_20260903192931_0RGBZWJN1ATQVRXF")).toBe("2026-09-03T19:29:31Z");
    expect(jazzHRRowDate("row_other")).toBe("");
  });

  it("parses the desktop job table once per job", () => {
    expect(parseJazzHRListing(LISTING)).toEqual([
      {
        jobId: "jA6qmBJarn",
        title: "Application Support Analyst - EMEA",
        location: "London, United Kingdom",
        postedDate: "2026-05-22T00:39:12Z",
      },
      {
        jobId: "nPMqeNSQOo",
        title: "Intern/Co-op- Summer 2027 - Software Engineering",
        location: "Pittsburgh, PA",
        postedDate: "2026-09-03T19:29:31Z",
      },
    ]);
  });

  it("reads the company name from Organization JSON-LD", () => {
    expect(parseJazzHRCompanyName(LISTING)).toBe("Innovative Systems");
    expect(parseJazzHRCompanyName("<html></html>")).toBeNull();
  });
});
