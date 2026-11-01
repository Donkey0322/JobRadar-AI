import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalizeApplyLink, isApplyShortLink, resolveApplyLink } from "../apply-link";

const SHORT_LINK = "https://go.vansh.nyc/YI?s=A";
const CAREER =
  "https://www.example.com/careers/software-engineer---new-grad-distributed-data-systems-2027-start-6865704002";
const CANONICAL = "https://job-boards.greenhouse.io/databricks/jobs/6865704002";

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: { location },
  });
}

describe("resolveApplyLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves a direct apply link unchanged", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveApplyLink(CAREER)).resolves.toBe(CAREER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a go.vansh.nyc redirect to the employer url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirect(CAREER)));

    await expect(resolveApplyLink(SHORT_LINK)).resolves.toBe(CAREER);
    expect(isApplyShortLink(SHORT_LINK)).toBe(true);
    expect(isApplyShortLink(CAREER)).toBe(false);
  });

  it("keeps the original link when the redirect lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    await expect(resolveApplyLink(SHORT_LINK)).resolves.toBe(SHORT_LINK);
  });

  it("rewrites a career page to the Greenhouse job once the page names the board", async () => {
    const html = `<script src="https://job-boards.greenhouse.io/embed/job_board/js?for=databricks"></script>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === SHORT_LINK) return Promise.resolve(redirect(CAREER));
        return Promise.resolve(new Response(html, { status: 200 }));
      })
    );

    await expect(canonicalizeApplyLink(SHORT_LINK)).resolves.toBe(CANONICAL);
  });

  it("leaves a Greenhouse board url unchanged", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(canonicalizeApplyLink(CANONICAL)).resolves.toBe(CANONICAL);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
