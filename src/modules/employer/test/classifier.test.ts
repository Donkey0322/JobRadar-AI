import { describe, expect, it } from "vitest";

import type { ATS } from "../type";

import { classifyATS } from "../classifier";
import { employers } from "../registry";

import { getJobKey } from "@/utils/job-key";

describe("classifyATS", () => {
  it.each<[string, ATS]>([
    ["https://boards.greenhouse.io/acme/jobs/1", "greenhouse"],
    ["https://jobs.lever.co/acme/1", "lever"],
    ["https://acme.wd1.myworkdayjobs.com/en-US/jobs", "workday"],
    ["https://acme.wd1.myworkdaysite.com/recruiting/acme/external", "workday"],
    ["https://jobs.ashbyhq.com/acme/1", "ashby"],
    ["https://acme.fa.us2.oraclecloud.com/jobs/1", "oraclecloud"],
    ["https://jobs.smartrecruiters.com/acme/1", "smartrecruiters"],
    ["https://careers-acme.icims.com/jobs/1", "icims"],
    ["https://acme.eightfold.ai/careers/job/1", "eightfold"],
    ["https://neboagency.applytojob.com/apply/AFMqe9Jb7b/Web-Development-Intern", "jazzhr"],
    [
      "https://career.innovativesystems.com/apply/jA6qmBJarn/Application-Support-Analyst-EMEA",
      "jazzhr",
    ],
    [
      "https://ats.rippling.com/collieraerospace/jobs/4981b0ba-5b6f-4ebe-95c0-9d1cda036b77",
      "rippling",
    ],
    ["https://ats.rippling.com/en-GB/moon/jobs/8b81bca7-1a64-4377-8ea8-869aac03080b", "rippling"],
    ["https://mujin.bamboohr.com/careers/126", "bamboohr"],
    ["https://nexthopai.bamboohr.com/careers/list", "bamboohr"],
    ["https://idtus.pinpointhq.com/en/postings/bca05641-f7af-494f-8b1e-dea500ca25e0", "pinpoint"],
    ["https://www.pinpointhq.com/", "custom"],
    ["https://www.bamboohr.com/careers/", "custom"],
    ["https://careers.arm.com/job/bengaluru/ip-verification-engineer/33099/99500560928", "radancy"],
    ["https://careers.arm.com/search-jobs", "radancy"],
    ["https://careers.cargill.com/en/search-jobs/resultspost", "radancy"],
    [
      "https://aramarkcareers.com/UnitedStates/job/West-Allis-Food-Service-Worker-WI-53227/1441993400/",
      "successfactors",
    ],
    [
      "https://careers.qorvo.com/job/Richardson-Software-Engineer-TX-75080/1435014200/",
      "successfactors",
    ],
    [
      "https://careers.dovercorporation.com/job/Keene-Software-Engineer-NH-03431/1404722033",
      "successfactors",
    ],
    ["https://assaabloy.jobs2web.com/search/?q=engineer", "successfactors"],
    ["https://careers.example.com/careers/jobs/123456?ats=successfactors", "successfactors"],
  ])("classifies the host suffix in %s", (url, ats) => {
    expect(classifyATS(new URL(url))).toBe(ats);
  });

  it.each<[string, ATS]>([
    ["https://stripe.com/jobs/1", "greenhouse"],
    ["https://deere.com/careers/1", "greenhouse"],
    [
      "https://www.hudsonrivertrading.com/hrt-job/algorithm-development-quant-research-trading-phd-internship-summer-2027/",
      "greenhouse",
    ],
  ])("applies the exact-host override for %s", (url, ats) => {
    expect(classifyATS(new URL(url))).toBe(ats);
  });

  it.each<[string, ATS]>([
    ["https://careers.example.com/job/1?8fold_id=1", "eightfold"],
    ["https://careers.example.com/job/1?ph_id=1", "phenom"],
    ["https://careers.bcg.com/global/en/job/59702", "phenom"],
    ["https://join.sephora.com/careers/job/790312030968", "eightfold"],
    ["https://career.mlp.com/careers/job/755957778821", "eightfold"],
    ["https://careers.example.com/job/1?ashby_jid=1", "ashby"],
    ["https://careers.example.com/job/1?gh_jid=1", "greenhouse"],
  ])("uses the tracking-parameter fallback in %s", (url, ats) => {
    expect(classifyATS(new URL(url))).toBe(ats);
  });

  it.each<[string, ATS]>([
    ["https://careers.garmin.com/jobs/18475?icims=1", "icims"],
    ["https://i3-corps.jibeapply.com/jobs/5420?lang=en-us", "icims"],
    ["https://careers.akima.com/jobs?keywords=&page=1", "icims"],
    ["https://careers.jhuapl.edu/jobs/60115", "icims"],
    ["https://careers.amd.com/jobs/90305?icims=1", "icims"],
    ["https://careers.amd.com/careers-home/jobs", "icims"],
  ])("routes iCIMS Jibe sites in %s", (url, ats) => {
    expect(classifyATS(new URL(url))).toBe(ats);
  });

  it("falls back to custom", () => {
    expect(classifyATS(new URL("https://careers.example.com/job/1"))).toBe("custom");
  });
});

describe("career sites in the host map", () => {
  it.each([
    [
      "https://careers.roblox.com/jobs/8242621",
      "https://careers.roblox.com/jobs/8242621?gh_jid=8242621",
      "greenhouse:roblox",
    ],
    [
      "https://www.riotgames.com/en/work-with-us/job/8282210",
      "https://www.riotgames.com/en/work-with-us/job/8282210?gh_jid=8282210",
      "greenhouse:riotgames",
    ],
    [
      "https://careers.cisco.com/global/en/job/1443405",
      "https://careers.cisco.com/global/en/job/1443405?ph_id=1443405",
      "phenom:careers.cisco.com",
    ],
    [
      "https://careers.zebra.com/careers/job/343621947586",
      "https://zebra.eightfold.ai/careers/job/343621947586?domain=zebra.com&8fold_id=343621947586",
      "eightfold:zebra",
    ],
    [
      "https://careers.qualcomm.com/careers?query=software&start=0&pid=446716309588&sort_by=relevance",
      "https://qualcomm.eightfold.ai/careers/job/446716309588",
      "eightfold:qualcomm",
    ],
    [
      "https://www.databricks.com/company/careers/university-recruiting---engineering/software-engineer---new-grad-distributed-data-systems-2027-start-6865704002",
      "https://job-boards.greenhouse.io/databricks/jobs/6865704002",
      "greenhouse:databricks",
    ],
    [
      "https://www.squarepoint-capital.com/open-opportunities?id=243853",
      "https://job-boards.greenhouse.io/squarepointcapital/jobs/243853",
      "greenhouse:squarepointcapital",
    ],
    [
      "https://jobs.ascension.org/us/en/job/R123456",
      "https://jobs.ascension.org/us/en/job/R123456?ph_id=R123456",
      "phenom:jobs.ascension.org",
    ],
    [
      "https://www.janestreet.com/join-jane-street/position/5869205002/",
      "https://job-boards.greenhouse.io/janestreet/jobs/5869205002",
      "greenhouse:janestreet",
    ],
    [
      "https://www.imc.com/us/careers/jobs/4823924101",
      "https://job-boards.eu.greenhouse.io/imc/jobs/4823924101",
      "greenhouse:imc",
    ],
    [
      "https://careers.newyorklife.com/careers/job/44633206",
      "https://newyorklife.eightfold.ai/careers/job/44633206",
      "eightfold:newyorklife",
    ],
    [
      "https://careers.lumen.com/careers/job/1133916066733",
      "https://lumen.eightfold.ai/careers/job/1133916066733",
      "eightfold:lumen",
    ],
    [
      "https://jobs.aligntech.com/en/postings/ae3e0699-444b-4266-b52f-51a2586ae69c",
      "https://jobs-aligntech.pinpointhq.com/en/postings/ae3e0699-444b-4266-b52f-51a2586ae69c",
      "pinpoint:jobs-aligntech",
    ],
    [
      "https://jobs.statefarm.com/jobs/45123",
      "https://jobs.statefarm.com/jobs/45123?icims=1",
      "icims:jobs.statefarm.com",
    ],
  ])("files %s with the board's own links", (siteUrl, boardUrl, companyKey) => {
    const url = new URL(siteUrl);

    expect(getJobKey(siteUrl)).toBe(getJobKey(boardUrl));
    expect(employers[classifyATS(url)].companyKeyFromUrl(url)).toBe(companyKey);
  });
});
