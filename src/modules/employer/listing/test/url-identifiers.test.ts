import { afterEach, describe, expect, it, vi } from "vitest";

import { ashbyFetcher } from "../ashby";
import { greenhouseFetcher } from "../greenhouse";
import { workdayFetcher } from "../workday";

describe("ATS URL hostname normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retains Ashby identifiers for www-prefixed override hosts", async () => {
    const company = await ashbyFetcher.formCompany(new URL("https://www.superhuman.com/careers"));

    expect(company.identifier).toBe("Superhuman%20Platform%20Inc");
  });

  it("maps Skyscanner career pages to the Ashby board id", async () => {
    const url = new URL(
      "https://www.skyscanner.com/jobs/job/49b878de-f727-4164-b306-4a4bc1b1b701?ashby_jid=49b878de-f727-4164-b306-4a4bc1b1b701"
    );

    expect(ashbyFetcher.companyKeyFromUrl(url)).toBe("ashby:eb485598-6bf3-40a5-8560-d70150131305");

    const company = await ashbyFetcher.formCompany(url);

    expect(company.name).toBe("skyscanner");
    expect(company.identifier).toBe("eb485598-6bf3-40a5-8560-d70150131305");
    expect(company.page).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/eb485598-6bf3-40a5-8560-d70150131305"
    );
  });

  it("retains Greenhouse identifiers for www-prefixed override hosts", async () => {
    const company = await greenhouseFetcher.formCompany(new URL("https://www.mlb.com/careers"));

    expect(company.identifier).toBe("majorleaguebaseball");
  });

  it("maps Duolingo career pages to the duolingo Greenhouse board", async () => {
    const url = new URL("https://careers.duolingo.com/jobs/8851677002?gh_jid=8851677002");

    expect(greenhouseFetcher.companyKeyFromUrl(url)).toBe("greenhouse:duolingo");

    const company = await greenhouseFetcher.formCompany(url);

    expect(company.identifier).toBe("duolingo");
    expect(company.page).toBe("https://boards-api.greenhouse.io/v1/boards/duolingo/jobs");
  });

  it("uses the company name when a careers host does not embed a Greenhouse board", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      })
    );

    const company = await greenhouseFetcher.formCompany(
      new URL("https://careers.roblox.com/jobs/8242619?gh_jid=8242619")
    );

    expect(company.identifier).toBe("roblox");
    expect(company.page).toBe("https://boards-api.greenhouse.io/v1/boards/roblox/jobs");
  });

  it("uses the company name when a jobs host does not embed a Greenhouse board", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      })
    );

    const company = await greenhouseFetcher.formCompany(
      new URL("https://jobs.dropbox.com/listing/6330377?gh_jid=6330377")
    );

    expect(company.identifier).toBe("dropbox");
    expect(company.page).toBe("https://boards-api.greenhouse.io/v1/boards/dropbox/jobs");
  });

  it("maps Konrad career pages to the konradgroup Greenhouse board", async () => {
    const url = new URL("https://www.konrad.com/careers/job/5893240003?gh_jid=5893240003");

    expect(greenhouseFetcher.companyKeyFromUrl(url)).toBe("greenhouse:konradgroup");

    const company = await greenhouseFetcher.formCompany(url);

    expect(company.identifier).toBe("konradgroup");
    expect(company.page).toBe("https://boards-api.greenhouse.io/v1/boards/konradgroup/jobs");
  });

  it("reads an X career page board token instead of the hostname label", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          `<input type="hidden" name="board_token" value="x9"/><a href="?gh_jid=8784053002">Apply</a>`,
      })
    );

    const url = new URL("https://x.company/careers/8784053002?gh_jid=8784053002");

    expect(greenhouseFetcher.companyKeyFromUrl(url)).toBe("greenhouse:host:x.company");

    const company = await greenhouseFetcher.formCompany(url);

    expect(company.identifier).toBe("x9");
    expect(company.page).toBe("https://boards-api.greenhouse.io/v1/boards/x9/jobs");
  });

  it("maps Quantbot career pages to the quantbot-technologies Greenhouse board", async () => {
    const url = new URL("https://www.quantbot.com/careers/4340833009?gh_jid=4340833009");

    expect(greenhouseFetcher.companyKeyFromUrl(url)).toBe("greenhouse:quantbot-technologies");

    const company = await greenhouseFetcher.formCompany(url);

    expect(company.identifier).toBe("quantbot-technologies");
    expect(company.page).toBe(
      "https://boards-api.greenhouse.io/v1/boards/quantbot-technologies/jobs"
    );
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
