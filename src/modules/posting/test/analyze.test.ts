import { beforeEach, describe, expect, it, vi } from "vitest";

const analyzeJDMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/posting/ai", () => ({
  default: analyzeJDMock,
  analyzeQualifications: vi.fn(),
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { Job } from "@/types";

import { analyzePosting } from "../analyze";
import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "../jd";

const job: Job = {
  company: "Acme",
  role: "Account Executive",
  link: "https://careers.example.com/jobs/1",
  location: "Austin, TX",
};

const screen = {
  citizenship: false,
  sponsorship: null,
  country: "USA",
  location: "Austin, TX",
  category: "entry level",
  season: "None",
};

describe("analyzePosting failures", () => {
  beforeEach(() => {
    analyzeJDMock.mockReset();
  });

  it.each([
    { name: "an empty AI result", result: null, reason: "empty" },
    { name: "a wrongly shaped AI result", result: JSON.stringify({ hello: "world" }), reason: "invalid" },
    { name: "an AI result that is not JSON", result: "not json at all", reason: "unparseable" },
  ])("reports $name as an AI failure, not a JD fetch error", async ({ result, reason }) => {
    analyzeJDMock.mockResolvedValue({ result, cost: 0.01 });

    const analysis = await analyzePosting(job, { jd: "Acme is hiring.", error: JD_FETCH_OK });

    expect(analysis).toEqual({
      jd: null,
      rawJD: "Acme is hiring.",
      cost: 0.01,
      error: JD_FETCH_OK,
      failure: { stage: "ai", reason },
    });
  });

  it("keeps the HTTP status of a real JD fetch failure and skips AI", async () => {
    const notFound = JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found");

    const analysis = await analyzePosting(job, { jd: null, error: notFound });

    expect(analysis).toEqual({
      jd: null,
      rawJD: "",
      cost: 0,
      error: notFound,
      failure: { stage: "fetch", error: notFound },
    });
    expect(analyzeJDMock).not.toHaveBeenCalled();
  });

  it("reports no failure when the AI result parses", async () => {
    analyzeJDMock.mockResolvedValue({ result: JSON.stringify(screen), cost: 0.01 });

    const analysis = await analyzePosting(job, { jd: "Acme is hiring.", error: JD_FETCH_OK });

    expect(analysis.failure).toBeNull();
    expect(analysis.error).toEqual(JD_FETCH_OK);
    expect(analysis.jd).toMatchObject({ country: "USA", category: "entry level" });
  });
});
