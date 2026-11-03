import { describe, expect, it } from "vitest";

import {
  getBambooHRJobId,
  getBambooHRSlug,
  isBambooHRHost,
  isBambooHRTenantResponse,
  parseBambooHRSiteName,
} from "../bamboohr";

describe("BambooHR helpers", () => {
  it.each([
    ["https://mujin.bamboohr.com/careers/126", true],
    ["https://MUJIN.bamboohr.com/careers", true],
    ["https://www.bamboohr.com/careers/", false],
    ["https://api.bamboohr.com/api/gateway.php", false],
    ["https://a.b.bamboohr.com/careers", false],
    ["https://bamboohr.com/careers", false],
    ["https://mujin.bamboohr.com.evil.io/careers", false],
  ])("recognizes tenant hosts in %s", (url, expected) => {
    expect(isBambooHRHost(new URL(url))).toBe(expected);
  });

  it("reads the tenant slug and job id", () => {
    expect(getBambooHRSlug(new URL("https://Mujin.bamboohr.com/careers/126"))).toBe("mujin");
    expect(getBambooHRJobId("/careers/126")).toBe("126");
    expect(getBambooHRJobId("/careers/126/")).toBe("126");
    expect(getBambooHRJobId("/careers/126/detail")).toBe("126");
    expect(getBambooHRJobId("/careers")).toBeNull();
    expect(getBambooHRJobId("/careers/list")).toBeNull();
  });

  it("treats a redirect to the marketing site as a missing tenant", () => {
    const redirected = new Response("<html></html>");
    Object.defineProperty(redirected, "url", { value: "https://www.bamboohr.com/" });
    const tenant = new Response("{}");
    Object.defineProperty(tenant, "url", { value: "https://mujin.bamboohr.com/careers/list" });

    expect(isBambooHRTenantResponse(redirected)).toBe(false);
    expect(isBambooHRTenantResponse(tenant)).toBe(true);
  });

  it("names the company from og:site_name", () => {
    expect(
      parseBambooHRSiteName(
        '<title>BambooHR</title><meta property="og:site_name" content=" Mujin " />'
      )
    ).toBe("Mujin");
    expect(parseBambooHRSiteName("<title>BambooHR</title>")).toBeNull();
  });
});
