import { describe, expect, it } from "vitest";

import { ashbyFetcher } from "../ashby";
import { greenhouseFetcher } from "../greenhouse";
import { workdayFetcher } from "../workday";

describe("ATS URL hostname normalization", () => {
  it("retains Ashby identifiers for www-prefixed override hosts", async () => {
    const company = await ashbyFetcher.formCompany(new URL("https://www.superhuman.com/careers"));

    expect(company.identifier).toBe("Superhuman%20Platform%20Inc");
  });

  it("retains Greenhouse identifiers for www-prefixed override hosts", async () => {
    const company = await greenhouseFetcher.formCompany(new URL("https://www.mlb.com/careers"));

    expect(company.identifier).toBe("majorleaguebaseball");
  });

  it("maps career subdomains to hardcoded Greenhouse slugs without scraping", async () => {
    const url = new URL("https://jobs.solarwinds.com/job-detail/?gh_jid=4716665005");

    expect(greenhouseFetcher.companyKeyFromUrl(url)).toBe("greenhouse:solarwinds");

    const company = await greenhouseFetcher.formCompany(url);

    expect(company.identifier).toBe("solarwinds");
    expect(company.page).toBe("https://boards-api.greenhouse.io/v1/boards/solarwinds/jobs");
  });

  it("maps generic Workday tenants to the real company identifier", () => {
    const company = workdayFetcher.formCompany(
      new URL(
        "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/AE-UNITED-ARAB-EMIRATES-CLIENT-SITE--United-Arab-Emirates-Remote---External-Site/UAE-CBL---Software-Developer-Trainer_01852388"
      )
    );

    expect(company.name).toBe("rtx");
    expect(company.identifier).toBe("rtx-rec_rtx_ext_gateway");
  });
});
