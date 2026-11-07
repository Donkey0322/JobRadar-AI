import { describe, expect, it } from "vitest";

import {
  getRadancyCompanyName,
  getRadancyJobId,
  getRadancyLocalePrefix,
  getRadancyResultsPostUrl,
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

describe("Radancy company names", () => {
  it.each([
    ["https://careers.arm.com/job/bengaluru/ip-verification-engineer/33099/1", "arm"],
    ["https://jobs.citi.com/job/warsaw/wealth-analyst/287/1", "citi"],
    ["https://www.capitalonecareers.com/job/plano/project-manager/1732/1", "capitalone"],
    ["https://jobs.disneycareers.com/job/orlando/engineer/391/1", "disney"],
    ["https://disneycareers.com/job/glendale/engineer/391/1", "disney"],
    ["https://retailcareers.staples.com/job/framingham/associate/49589/1", "staples"],
    ["https://careers.staples.com/en/job/-/-/44412/1", "staples"],
    ["https://kaiserpermanentejobs.org/job/oakland/analyst/1/1", "kaiserpermanente"],
    ["https://schwabjobs.com/job/austin/engineer/1/1", "schwab"],
    ["https://santandercareers.com/job/boston/analyst/1/1", "santander"],
    ["https://jobs.thetorocompany.com/job/bloomington/engineer/1/1", "thetorocompany"],
    ["https://careers.l3harris.com/job/melbourne/engineer/1/1", "l3harris"],
  ])("uses %s as %s", (url, name) => {
    expect(getRadancyCompanyName(new URL(url))).toBe(name);
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

  // Cards trimmed from each site's live search-jobs/resultspost HTML.
  it.each([
    {
      site: "Capital One",
      card: `<a href="/job/plano/full-stack-engineer-5/1732/102946843680" data-job-id="102946843680">
        <div class="job-search-info"><span>102946843680</span> <span class="job-date-posted">11/06/2026</span></div>
        <h2>Full-stack Engineer 5</h2> <span class="job-location">Plano, TX</span>
      </a>
      <button data-a11y-saved-button="" class="js-save-job-btn" data-job-id="102946843680" data-org-id="1732">Save Job</button>`,
      title: "Full-stack Engineer 5",
      location: "Plano, TX",
    },
    {
      site: "Schwab",
      card: `<a href="/job/austin/c-sharp-net-developer/33727/99734774000" data-job-id="99734774000">
        <h2>C Sharp / .Net Developer</h2> <span class="job-location">Austin, TX; Southlake, TX</span>
        <div><span class="job-req-id"><b>Requisition ID: </b> 2026-125748</span></div>
        <div><span class="job-req-id "><b>Application deadline: </b> 2026-11-11</span></div>
        <button type="button" class="js-save-job-btn" data-job-id="99734774000" data-org-id="33727">Save for Later</button>
      </a>`,
      title: "C Sharp / .Net Developer",
      location: "Austin, TX; Southlake, TX",
    },
    {
      site: "Toro",
      card: `<a href="/job/tomah/assembler-1st-shift-the-toro-company/40062/102956481344" data-job-id="102956481344">
        <span class="job-brand job-brand__toro"><span class="wai">Toro</span></span>
        <span class="job-title">Assembler, 1st Shift - The Toro Company</span>
        <span class="job-category"> Production </span> <span class="job-location">Tomah, WI</span>
      </a>
      <button type="button" class="js-save-job-btn" data-job-id="102956481344" data-org-id="40062"><span class="wai">Save for Later</span></button>`,
      title: "Assembler, 1st Shift - The Toro Company",
      location: "Tomah, WI",
    },
    {
      site: "Staples",
      card: `<a href="/en/job/greencastle/warehouse-bulk-full-time-2nd-shift/44412/102954356448" data-job-id="102954356448">
        <h2>Warehouse Bulk Full Time 2nd Shift</h2>
        <div class="search-results-link"><span class="job-location"><strong>Greencastle, PA</strong></span>
        <span class="job-info job-category"><strong>Category:</strong> Warehouse</span>
        <span class="job-id"><strong>Job ID:</strong> 77299</span></div>
      </a>`,
      title: "Warehouse Bulk Full Time 2nd Shift",
      location: "Greencastle, PA",
    },
    {
      site: "UnitedHealth Group",
      card: `<a href="/job/plymouth/coding-quality-analyst/34088/102964786896" data-job-id="102964786896">
        <div><h2>Coding Quality Analyst</h2> <span class="job-id job-info">2393157</span>
        <span class="job-divider"> | </span> <span class="job-location 1">Plymouth, Minnesota</span>
        <span class="job-divider"> | </span> <span class="job-info job-worksetting">Remote</span></div>
      </a>`,
      title: "Coding Quality Analyst",
      location: "Plymouth, Minnesota",
    },
    {
      site: "Comcast",
      card: `<a href="/job/new-york/programmatic-account-director/45483/102962359664" data-job-id="102962359664">
        <h2>Programmatic Account Director</h2>
        <div class="facet-group"><span class="job-location">Multiple Locations</span>
        <span class="job-info job-category"><span>Sales</span></span> <span class="job-date-posted">11/06/2026</span></div>
      </a>`,
      title: "Programmatic Account Director",
      location: "Multiple Locations",
    },
    {
      site: "Disney",
      card: `<a href="/job/lake-buena-vista/lead-software-engineer/391/102963747664" data-job-id="102963747664">
        <h2>Lead Software Engineer</h2> <span class="job-brand">Disney Experiences</span>
        <span class="job-location">Lake Buena Vista, Florida</span> <span class="job-date-posted">Nov. 07, 2026</span>
      </a>
      <button type="button" class="js-save-job-btn" data-job-id="102963747664" data-org-id="391"><span>Save Job</span></button>`,
      title: "Lead Software Engineer",
      location: "Lake Buena Vista, Florida",
    },
    {
      site: "L3Harris",
      card: `<a href="/job/palm-bay/lead-project-engineering/4832/100946517568" data-job-id="100946517568">
        <h2>Lead, Project Engineering</h2> <span class="results-facet job-category">Engineering</span>
        <span class="results-facet job-location test3">Palm Bay, Brevard, FL</span>
      </a>`,
      title: "Lead, Project Engineering",
      location: "Palm Bay, Brevard, FL",
    },
  ])("keeps only the title on $site cards", ({ card, title, location }) => {
    const [job] = parseRadancyJobs(`<ul><li>${card}</li></ul>`, "https://jobs.example.com");

    expect(job).toMatchObject({ title, location });
  });

  it("prefers .job-title, then h2, then h3 over the card text", () => {
    const html = `
      <ul>
        <li><a href="/job/a/b/1/1" data-job-id="1"><h3>Team</h3><h2>Heading</h2><span class="job-title">Title</span></a></li>
        <li><a href="/job/a/b/1/2" data-job-id="2"><h3>Team</h3><h2>Heading</h2> Austin, TX</a></li>
        <li><a href="/job/a/b/1/3" data-job-id="3"><span>99</span><h3>Heading</h3> Austin, TX</a></li>
        <li><a href="/job/a/b/1/4" data-job-id="4"><h2> </h2><h3>Fallback</h3></a></li>
      </ul>
    `;

    expect(parseRadancyJobs(html, "https://jobs.example.com").map((job) => job.title)).toEqual([
      "Title",
      "Heading",
      "Heading",
      "Fallback",
    ]);
  });
});
