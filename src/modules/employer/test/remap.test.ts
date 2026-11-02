import { describe, expect, it } from "vitest";

import type { Company } from "@/types";

import { knownEmployerName, remapStoredCompany } from "../remap";

const PRETTY =
  "https://www.example.com/company/careers/software-engineer---new-grad-distributed-data-systems-2027-start-6865704002";
const CANONICAL = "https://job-boards.greenhouse.io/databricks/jobs/6865704002";

const databricks: Company = {
  name: "databricks",
  ats: "greenhouse",
  identifier: "databricks",
  domain: "https://databricks.com",
  page: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs",
  urls: [],
};

describe("knownEmployerName", () => {
  it("uses the stored employer for a Greenhouse board url", () => {
    const companiesByKey = new Map([["greenhouse:databricks", databricks]]);

    expect(knownEmployerName(CANONICAL, companiesByKey)).toBe("Databricks");
  });

  it("returns null when the link is still a career page or apply short link", () => {
    const companiesByKey = new Map([["greenhouse:databricks", databricks]]);

    expect(knownEmployerName(PRETTY, companiesByKey)).toBeNull();
    expect(knownEmployerName("https://go.vansh.nyc/YI?s=A", companiesByKey)).toBeNull();
  });
});

describe("remapStoredCompany", () => {
  it("capitalizes a lowercase slug and keeps an existing mixed-case name", () => {
    const dell: Company = {
      name: "Dell Technologies",
      ats: "oraclecloud",
      identifier: "iawmqy.fa.ocs.oraclecloud.com",
      domain:
        "https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job",
      page: "https://iawmqy.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
      urls: [],
    };
    const link =
      "https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/298784";
    const companiesByKey = new Map([["oraclecloud:iawmqy.fa.ocs.oraclecloud.com", dell]]);

    expect(
      remapStoredCompany(
        {
          company: "iawmqy.fa.ocs.oraclecloud.com",
          role: "Software Engineer 1 - IT",
          link,
          location: "Texas",
        },
        companiesByKey
      ).company
    ).toBe("Dell Technologies");

    const rtx: Company = {
      name: "rtx",
      ats: "workday",
      identifier: "rtx-rec_rtx_ext_gateway",
      domain: "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway",
      page: "https://globalhr.wd5.myworkdayjobs.com/wday/cxs/globalhr/rec_rtx_ext_gateway/jobs",
      urls: [],
    };
    const rtxLink =
      "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/US-CT-EAST-HARTFORD-G/Intern_01832259";

    expect(
      remapStoredCompany(
        { company: "globalhr", role: "Intern", link: rtxLink, location: "CT" },
        new Map([["workday:rtx-rec_rtx_ext_gateway", rtx]])
      ).company
    ).toBe("Rtx");
  });
});
