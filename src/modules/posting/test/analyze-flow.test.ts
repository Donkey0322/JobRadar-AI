import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JD, Job } from "@/types";

import { JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/employer/detail";
import { JobCategory } from "@/validation/config";

const analyzePostingMock = vi.hoisted(() => vi.fn());
const extractQualificationsMock = vi.hoisted(() => vi.fn());
const getRawJDMock = vi.hoisted(() => vi.fn());

vi.mock("../analyze", () => ({
  analyzePosting: analyzePostingMock,
  extractQualifications: extractQualificationsMock,
  getRawJD: getRawJDMock,
}));

import { analyzeLink, Posting } from "../posting";

const job: Job = {
  company: "Acme",
  role: "Junior Software Engineer",
  link: "https://example.com/jobs/1",
  location: "Remote",
};

const screened: JD = {
  citizenship: false,
  sponsorship: true,
  qualifications: null,
  country: "USA",
  location: "Remote",
  category: JobCategory.ENTRY_LEVEL,
  season: "None",
};

describe("Posting.analyze", () => {
  beforeEach(() => {
    analyzePostingMock.mockReset();
    extractQualificationsMock.mockReset();
    getRawJDMock.mockReset();
  });

  it("leaves the job passed to the analyzer unchanged and stores the final jd", async () => {
    const posting = Posting.from(job);
    analyzePostingMock.mockImplementation(async (input: Job) => {
      expect(input).not.toBe(posting);
      expect(input).not.toHaveProperty("jd");
      return {
        jd: screened,
        rawJD: "raw",
        cost: 0.1,
        error: JD_FETCH_OK,
      };
    });
    extractQualificationsMock.mockResolvedValue({
      qualifications: ["TypeScript"],
      cost: 0.2,
    });

    const result = await posting.analyze();

    expect(job).not.toHaveProperty("jd");
    expect(posting.jd).toEqual({ ...screened, qualifications: ["TypeScript"] });
    expect(result.jd).toEqual(posting.jd);
    expect(result.cost).toBeCloseTo(0.3);
  });

  it("keeps the screened jd and adds the failed qualification cost", async () => {
    const posting = Posting.from(job);
    analyzePostingMock.mockResolvedValue({
      jd: screened,
      rawJD: "raw",
      cost: 0.1,
      error: JD_FETCH_OK,
    });
    extractQualificationsMock.mockResolvedValue({ qualifications: null, cost: 0.2 });

    const result = await posting.analyze();

    expect(posting.jd).toEqual(screened);
    expect(result.jd).toEqual(screened);
    expect(result.cost).toBeCloseTo(0.3);
  });

  it("skips qualification extraction when the screened job is ineligible", async () => {
    const posting = Posting.from(job);
    analyzePostingMock.mockResolvedValue({
      jd: { ...screened, category: JobCategory.SENIOR_LEVEL },
      rawJD: "raw",
      cost: 0.1,
      error: JD_FETCH_OK,
    });

    const result = await posting.analyze();

    expect(extractQualificationsMock).not.toHaveBeenCalled();
    expect(result.cost).toBe(0.1);
    expect(posting.jd?.category).toBe(JobCategory.SENIOR_LEVEL);
  });

  it("extracts qualifications for a bare link that passes eligibility", async () => {
    analyzePostingMock.mockResolvedValue({
      jd: screened,
      rawJD: "raw",
      cost: 0.1,
      error: JD_FETCH_OK,
    });
    extractQualificationsMock.mockResolvedValue({
      qualifications: ["TypeScript"],
      cost: 0.2,
    });

    const jd = await analyzeLink("https://example.com/jobs/bare");

    expect(extractQualificationsMock).toHaveBeenCalledWith("raw");
    expect(jd?.qualifications).toEqual(["TypeScript"]);
  });

  it("returns null when analysis fails", async () => {
    analyzePostingMock.mockResolvedValue({
      jd: null,
      rawJD: "",
      cost: 0,
      error: JD_FETCH_ERROR.noData(),
    });

    const jd = await analyzeLink(job.link);

    expect(jd).toBeNull();
    expect(extractQualificationsMock).not.toHaveBeenCalled();
  });
});

describe("Posting.getRawJD", () => {
  beforeEach(() => {
    getRawJDMock.mockReset();
  });

  it("delegates to the raw JD fetch for this link", async () => {
    getRawJDMock.mockResolvedValue({ jd: "raw", error: JD_FETCH_OK });

    const result = await Posting.from(job).getRawJD();

    expect(getRawJDMock).toHaveBeenCalledWith(job.link, undefined);
    expect(result.jd).toBe("raw");
  });
});
