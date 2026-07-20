import { describe, expect, it } from "vitest";

import type { ATS } from "../type";

import { classifyATS } from "./index";

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
  ])("classifies the host suffix in %s", (url, ats) => {
    expect(classifyATS(new URL(url))).toBe(ats);
  });

  it.each<[string, ATS]>([
    ["https://stripe.com/jobs/1", "greenhouse"],
    ["https://deere.com/careers/1", "greenhouse"],
  ])("applies the exact-host override for %s", (url, ats) => {
    expect(classifyATS(new URL(url))).toBe(ats);
  });

  it.each<[string, ATS]>([
    ["https://careers.example.com/job/1?8fold_id=1", "eightfold"],
    ["https://careers.example.com/job/1?ph_id=1", "phenom"],
    ["https://careers.example.com/job/1?ashby_jid=1", "ashby"],
    ["https://careers.example.com/job/1?gh_jid=1", "greenhouse"],
  ])("uses the tracking-parameter fallback in %s", (url, ats) => {
    expect(classifyATS(new URL(url))).toBe(ats);
  });

  it("falls back to custom", () => {
    expect(classifyATS(new URL("https://careers.example.com/job/1"))).toBe("custom");
  });
});
