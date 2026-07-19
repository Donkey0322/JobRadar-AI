import { describe, expect, it } from "vitest";

import { findIcimsIframeSrc, isIcimsUrl, normalizeIcimsUrl } from "./icims";

const BASE_URL = "https://example.com/careers";

describe("findIcimsIframeSrc", () => {
  it("discovers search URLs from iframe, noscript, and raw script content", () => {
    const iframe = `<iframe src="https://careers-acme.icims.com/jobs/search?mobile=true"></iframe>`;
    const noscript =
      "<noscript>&lt;iframe src=&quot;//careers-acme.icims.com/jobs/search&quot;&gt;" +
      "&lt;/iframe&gt;</noscript>";
    const script =
      '<script>window.jobs = "https://careers-acme.icims.com/jobs/search?in_iframe=1";</script>';

    expect(findIcimsIframeSrc(iframe, BASE_URL, "search")).toBe(
      "https://careers-acme.icims.com/jobs/search?mobile=true"
    );
    expect(findIcimsIframeSrc(noscript, BASE_URL, "search")).toBe(
      "https://careers-acme.icims.com/jobs/search"
    );
    expect(findIcimsIframeSrc(script, BASE_URL, "search")).toBe(
      "https://careers-acme.icims.com/jobs/search?in_iframe=1"
    );
  });

  it("discovers detail URLs without allowing search/detail targets to cross", () => {
    const detail =
      '<iframe src="https://careers-acme.icims.com/jobs/123/software-engineer/job?mobile=true">' +
      "</iframe>";
    const detailNoscript =
      "<noscript>&lt;iframe src=&quot;/jobs/456/data-engineer/job&quot;&gt;" +
      "&lt;/iframe&gt;</noscript>";
    const detailScript =
      '<script>window.job = "https://careers-acme.icims.com/jobs/789/product-engineer/job";</script>';
    const search = '<iframe src="https://careers-acme.icims.com/jobs/search"></iframe>';

    expect(findIcimsIframeSrc(detail, BASE_URL, "job")).toBe(
      "https://careers-acme.icims.com/jobs/123/software-engineer/job?mobile=true"
    );
    expect(findIcimsIframeSrc(detailNoscript, BASE_URL, "job")).toBe(
      "https://example.com/jobs/456/data-engineer/job"
    );
    expect(findIcimsIframeSrc(detailScript, BASE_URL, "job")).toBe(
      "https://careers-acme.icims.com/jobs/789/product-engineer/job"
    );
    expect(findIcimsIframeSrc(detail, BASE_URL, "search")).toBeNull();
    expect(findIcimsIframeSrc(search, BASE_URL, "job")).toBeNull();
  });
});

describe("iCIMS URL classification and normalization", () => {
  it("classifies only the requested target", () => {
    const search = new URL("https://careers-acme.icims.com/jobs/search");
    const job = new URL("https://careers-acme.icims.com/jobs/123/software-engineer/job");

    expect(isIcimsUrl(search, "search")).toBe(true);
    expect(isIcimsUrl(search, "job")).toBe(false);
    expect(isIcimsUrl(job, "job")).toBe(true);
    expect(isIcimsUrl(job, "search")).toBe(false);
  });

  it("preserves search parameters but strips detail tracking parameters", () => {
    expect(
      normalizeIcimsUrl("https://careers-acme.icims.com/jobs/search?pr=2&mobile=true", "search")
    ).toBe("https://careers-acme.icims.com/jobs/search?pr=2&mobile=true&in_iframe=1");

    expect(
      normalizeIcimsUrl(
        "https://careers-acme.icims.com/jobs/123/software-engineer/job?mobile=true&width=900",
        "job"
      )
    ).toBe("https://careers-acme.icims.com/jobs/123/software-engineer/job?in_iframe=1");
  });
});
