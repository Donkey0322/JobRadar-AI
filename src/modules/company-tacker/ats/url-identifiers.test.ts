import { describe, expect, it } from "vitest";

import { ashbyFetcher } from "./ashby";
import { greenhouseFetcher } from "./greenhouse";
import { workdayFetcher } from "./workday";

describe("ATS URL hostname normalization", () => {
  it("retains Ashby identifiers for www-prefixed override hosts", async () => {
    const company = await ashbyFetcher.formCompany(new URL("https://www.superhuman.com/careers"));

    expect(company.identifier).toBe("Superhuman%20Platform%20Inc");
  });

  it("retains Greenhouse identifiers for www-prefixed override hosts", async () => {
    const company = await greenhouseFetcher.formCompany(new URL("https://www.mlb.com/careers"));

    expect(company.identifier).toBe("majorleaguebaseball");
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
