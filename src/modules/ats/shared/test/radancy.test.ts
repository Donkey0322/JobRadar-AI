import { describe, expect, it } from "vitest";

import {
  getRadancyJobId,
  getRadancyLocalePrefix,
  getRadancyResultsPostUrl,
  isRadancyHtml,
  isRadancyUrl,
  parseRadancyJobs,
} from "../radancy";

const ARM_JOB = "https://careers.arm.com/job/bengaluru/ip-verification-engineer/33099/99500560928";

describe("Radancy URL classification", () => {
  it.each([
    ARM_JOB,
    "https://jobs.citi.com/job/warsaw/wealth-analyst/287/99487070624",
    "https://careers.cargill.com/en/job/atlanta/software-engineer-intern-summer-2026-atlanta-ga/23251/85180324464",
    "https://careers.staples.com/en/job/-/-/44412/86032290864",
    "https://careers.arm.com/search-jobs",
    "https://careers.arm.com/search-jobs/resultspost",
    "https://careers.cargill.com/en/search-jobs",
    "https://careers.cargill.com/en/search-jobs/resultspost",
  ])("recognizes %s", (url) => {
    expect(isRadancyUrl(new URL(url))).toBe(true);
  });

  it.each([
    "https://careers.example.com/job/1",
    "https://acme.eightfold.ai/careers/job/1",
    "https://careers.dovercorporation.com/job/Austin-Engineer-TX-78728/1382415233",
    "https://jobs.example.com/careers",
  ])("rejects %s", (url) => {
    expect(isRadancyUrl(new URL(url))).toBe(false);
  });
});

describe("Radancy URL helpers", () => {
  it("uses the Arm verification job id and listing endpoint", () => {
    const url = new URL(ARM_JOB);

    expect(getRadancyJobId(url)).toBe("99500560928");
    expect(getRadancyLocalePrefix(url)).toBe("");
    expect(getRadancyResultsPostUrl(url)).toBe("https://careers.arm.com/search-jobs/resultspost");
  });

  it("keeps a locale prefix on branded TalentBrew sites", () => {
    const url = new URL(
      "https://careers.cargill.com/en/job/atlanta/software-engineer-intern/23251/85180324464"
    );

    expect(getRadancyLocalePrefix(url)).toBe("/en");
    expect(getRadancyResultsPostUrl(url)).toBe(
      "https://careers.cargill.com/en/search-jobs/resultspost"
    );
  });
});

describe("Radancy HTML parsing", () => {
  it("detects TalentBrew fingerprints", () => {
    expect(isRadancyHtml('<script src="https://tbcdn.talentbrew.com/js/client/search.js">')).toBe(
      true
    );
    expect(isRadancyHtml('<section data-ajax-post-url="/search-jobs/resultspost">')).toBe(true);
    expect(isRadancyHtml("<main>Careers</main>")).toBe(false);
  });

  it("parses Arm job cards including the verification posting", () => {
    const html = `
      <ul id="search-results-jobs">
        <li class="job-card">
          <a class="job-card__title" href="/job/bengaluru/ip-verification-engineer/33099/99500560928" data-job-id="99500560928">
            IP Verification Engineer
          </a>
          <span class="location">Bengaluru, India</span>
        </li>
      </ul>
    `;

    expect(parseRadancyJobs(html, "https://careers.arm.com")).toEqual([
      {
        jobId: "99500560928",
        title: "IP Verification Engineer",
        link: ARM_JOB,
        location: "Bengaluru, India",
      },
    ]);
  });

  it("parses Citi and Cargill card variants", () => {
    const html = `
      <div class="sr-job-item">
        <h3 class="sr-job-item__title">
          <a class="sr-job-item__link" href="/job/pune/software-engineer/287/1" data-job-id="1">
            Software Engineer
          </a>
        </h3>
        <span class="sr-job-item__facet sr-job-location">Pune, India</span>
      </div>
      <ul>
        <li>
          <a href="/en/job/atlanta/software-engineer-intern/23251/2" data-job-id="2">
            <h3>Software Engineer Intern</h3>
            <span class="job-location">Atlanta, Georgia</span>
          </a>
        </li>
      </ul>
    `;

    expect(parseRadancyJobs(html, "https://jobs.example.com")).toEqual([
      {
        jobId: "1",
        title: "Software Engineer",
        link: "https://jobs.example.com/job/pune/software-engineer/287/1",
        location: "Pune, India",
      },
      {
        jobId: "2",
        title: "Software Engineer Intern",
        link: "https://jobs.example.com/en/job/atlanta/software-engineer-intern/23251/2",
        location: "Atlanta, Georgia",
      },
    ]);
  });
});
