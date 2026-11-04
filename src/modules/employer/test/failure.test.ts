import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => ({ errorLog: { append: vi.fn() } }));

import type { Company } from "@/types";

import { ListingHttpError, logListingFailure, logListingStatus } from "../failure";

import { errorLog } from "@/store";

const company: Company = {
  name: "Acme",
  ats: "custom",
  identifier: "acme",
  domain: "https://acme.com",
  page: "https://acme.com/jobs",
  urls: [],
};

describe("listing failure log", () => {
  beforeEach(() => {
    vi.mocked(errorLog.append).mockReset();
  });

  it("writes an error status as one line", async () => {
    const res = new Response("", { status: 429, statusText: "Too Many Requests" });

    await logListingStatus("Netflix", company, res, "page 2");

    expect(errorLog.append).toHaveBeenCalledWith(
      "Netflix: Acme - 429 - Too Many Requests (page 2)"
    );
  });

  it("writes thrown HTTP errors and unreachable hosts", async () => {
    const res = new Response("", { status: 410, statusText: "Gone" });
    const tls = new TypeError("fetch failed", { cause: new Error("certificate has expired") });

    await expect(logListingFailure("Phenom", company, ListingHttpError.from(res))).resolves.toBe(
      true
    );
    await expect(logListingFailure("Lever", company, tls)).resolves.toBe(true);

    expect(vi.mocked(errorLog.append).mock.calls).toEqual([
      ["Phenom: Acme - 410 - Gone"],
      ["Lever: Acme - certificate has expired"],
    ]);
  });

  it("leaves other errors to the caller", async () => {
    await expect(logListingFailure("Lever", company, new Error("boom"))).resolves.toBe(false);
    await expect(
      logListingFailure("Lever", company, new DOMException("timed out", "TimeoutError"))
    ).resolves.toBe(false);

    expect(errorLog.append).not.toHaveBeenCalled();
  });
});
