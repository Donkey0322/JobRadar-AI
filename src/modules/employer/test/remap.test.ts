import { describe, expect, it } from "vitest";

import type { Company } from "@/types";

import { knownEmployerName } from "../remap";

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
