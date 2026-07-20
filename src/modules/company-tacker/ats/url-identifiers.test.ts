import { describe, expect, it } from "vitest";

import { ashbyFetcher } from "./ashby";
import { greenhouseFetcher } from "./greenhouse";

describe("ATS URL hostname normalization", () => {
  it("retains Ashby identifiers for www-prefixed override hosts", async () => {
    const company = await ashbyFetcher.formCompany(new URL("https://www.superhuman.com/careers"));

    expect(company.identifier).toBe("Superhuman%20Platform%20Inc");
  });

  it("retains Greenhouse identifiers for www-prefixed override hosts", async () => {
    const company = await greenhouseFetcher.formCompany(new URL("https://www.mlb.com/careers"));

    expect(company.identifier).toBe("majorleaguebaseball");
  });
});
