import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Company } from "@/types";

import { companyKey, groupUrlsByCompanyKey } from "../build";
import { careerSiteAlias, companyKeyFromUrl } from "../keys";
import { employers } from "../registry";
import { knownEmployerName, remapStoredCompany } from "../remap";

import { classifyATS } from "@/modules/ats/classify";

const DEXCOM_URL = "https://careers.dexcom.com/careers/job/37990370";

const dexcom: Company = {
  name: "dexcom",
  ats: "workday",
  identifier: "dexcom-dexcom",
  domain: "https://dexcom.wd1.myworkdayjobs.com/Dexcom",
  page: "https://dexcom.wd1.myworkdayjobs.com/wday/cxs/dexcom/Dexcom/jobs",
  urls: [],
};

const aliasUrls = readFileSync(
  path.join(import.meta.dirname, "../../ats/job-key/test/fixtures/keys.tsv"),
  "utf-8"
)
  .split("\n")
  .filter((line) => line.startsWith("alias\t"))
  .map((line) => line.split("\t")[2]);

function buildKey(url: string) {
  return [...groupUrlsByCompanyKey([url]).keys()][0];
}

function record(company: string, link: string) {
  return { company, role: "Software Engineer Intern", link, location: "San Diego, CA" };
}

describe("career-site alias company keys", () => {
  it("resolves a Dexcom career-site URL to the stored Workday company in build and remap", () => {
    const companiesByKey = new Map([[companyKey(dexcom), dexcom]]);

    expect(companyKey(dexcom)).toBe("workday:dexcom-dexcom");
    expect(buildKey(DEXCOM_URL)).toBe("workday:dexcom-dexcom");
    expect(companyKeyFromUrl(new URL(DEXCOM_URL))).toBe("workday:dexcom-dexcom");
    expect(knownEmployerName(DEXCOM_URL, companiesByKey)).toBe("Dexcom");
    expect(remapStoredCompany(record("careers.dexcom.com", DEXCOM_URL), companiesByKey).company).toBe(
      "Dexcom"
    );
  });

  it("gives every alias URL the same company key in build and remap", () => {
    expect(aliasUrls).toHaveLength(9);

    for (const url of aliasUrls) {
      expect(careerSiteAlias(url), url).not.toBeNull();
      expect(companyKeyFromUrl(new URL(url)), url).toBe(buildKey(url));
    }
  });

  it.each([
    "https://job-boards.greenhouse.io/databricks/jobs/6865704002",
    "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/US-CT-EAST-HARTFORD-G/Intern_01832259",
    "https://wd1.myworkdaysite.com/recruiting/clorox/Clorox/job/Brampton-Ontario--CAN/Data---Analytics-Analyst_JR23400",
    "https://careers.example.com/jobs/123",
  ])("keeps the ATS company key for a non-alias URL: %s", (link) => {
    const url = new URL(link);
    const atsKey = employers[classifyATS(url)].companyKeyFromUrl(url);

    expect(careerSiteAlias(link)).toBeNull();
    expect(companyKeyFromUrl(url)).toBe(atsKey);
    expect(buildKey(link)).toBe(atsKey);
  });

  it("leaves an alias URL unmatched when its target company is not stored", () => {
    const unrelated: Company = { ...dexcom, name: "micron", identifier: "micron-external" };
    const companiesByKey = new Map([[companyKey(unrelated), unrelated]]);
    const stored = record("careers.dexcom.com", DEXCOM_URL);

    expect(buildKey(DEXCOM_URL)).toBe("workday:dexcom-dexcom");
    expect(knownEmployerName(DEXCOM_URL, companiesByKey)).toBeNull();
    expect(remapStoredCompany(stored, companiesByKey)).toBe(stored);
  });
});
