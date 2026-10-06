import { describe, expect, it } from "vitest";

import { oracleCompanyName } from "../oraclecloud";

describe("oracleCompanyName", () => {
  it("replaces a career-page title with the mapped company", () => {
    expect(
      oracleCompanyName("JPMC Candidate Experience page", "jpmc.fa.oraclecloud.com")
    ).toBe("JP Morgan Chase");
    expect(oracleCompanyName("Candidate Experience site", "edel.fa.us2.oraclecloud.com")).toBe(
      "Fortinet"
    );
    expect(oracleCompanyName("Candidate Experience site", "ecnf.fa.us2.oraclecloud.com")).toBe(
      "Tradeweb"
    );
    expect(oracleCompanyName("Candidate Experience site", "hcgn.fa.us2.oraclecloud.com")).toBe(
      "Citizens"
    );
  });

  it("keeps the brand from a career-page title when the host is not mapped", () => {
    expect(
      oracleCompanyName(
        "Akamai Career Site",
        "fa-extu-saasfaprod1.fa.ocs.oraclecloud.com"
      )
    ).toBe("Akamai");
    expect(
      oracleCompanyName(
        "S&C Minimal Career Site",
        "ejia.fa.us6.oraclecloud.com"
      )
    ).toBe("S&C");
    expect(
      oracleCompanyName(
        "WTW External Careers Site",
        "eedu.fa.em3.oraclecloud.com"
      )
    ).toBe("WTW");
    expect(
      oracleCompanyName("BHE Career Site", "fa-essf-saasfaprod1.fa.ocs.oraclecloud.com")
    ).toBe("BHE");
  });

  it("leaves a real site name unchanged", () => {
    expect(oracleCompanyName("Harmonic Inc.", "egmn.fa.us2.oraclecloud.com")).toBe(
      "Harmonic Inc."
    );
    expect(oracleCompanyName("Coherent Corp. US", "hcwp.fa.us2.oraclecloud.com")).toBe(
      "Coherent Corp. US"
    );
  });
});
