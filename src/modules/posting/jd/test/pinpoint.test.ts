import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPinpointJD } from "../pinpoint";

const ID = "bca05641-f7af-494f-8b1e-dea500ca25e0";
const mockFetch = vi.fn<typeof fetch>();

describe("fetchPinpointJD", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("reads the posting's sections from the tenant feed", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        data: [
          { id: "1", title: "Other", path: "/en/postings/00000000-0000-4000-8000-000000000000" },
          {
            id: "2",
            title: "Senior Systems Engineer",
            path: `/en/postings/${ID}`,
            description: "<p>Build <b>systems</b></p>",
            key_responsibilities: "<ul><li>Design</li></ul>",
            skills_knowledge_expertise: null,
            benefits: "<div>401(k)</div>",
          },
        ],
      })
    );

    const result = await fetchPinpointJD(
      `https://idtus.pinpointhq.com/en/postings/${ID}?ats=pinpointhq`,
      AbortSignal.timeout(1000)
    );

    expect(String(mockFetch.mock.calls[0][0])).toBe("https://idtus.pinpointhq.com/postings.json");
    expect(result.jd).toContain("Build systems");
    expect(result.jd).toContain("Design");
    expect(result.jd).toContain("401(k)");
  });

  it("reports no data when the posting has closed", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ data: [] }));

    const result = await fetchPinpointJD(
      `https://idtus.pinpointhq.com/en/postings/${ID}`,
      AbortSignal.timeout(1000)
    );

    expect(result.jd).toBeNull();
  });

  it("rejects URLs without a posting UUID", async () => {
    const result = await fetchPinpointJD("https://idtus.pinpointhq.com/en/postings");

    expect(result.jd).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
