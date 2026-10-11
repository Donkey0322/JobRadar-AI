import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_JD_FETCH_TIMEOUT_MS } from "@/constants";

import type { JD, Job } from "@/types";

import { JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/posting/jd/fetch";
import { JobCategory } from "@/validation/config";

const analyzePostingMock = vi.hoisted(() => vi.fn());
const extractQualificationsMock = vi.hoisted(() => vi.fn());
const fetchPostingJDMock = vi.hoisted(() => vi.fn());

vi.mock("../analyze", () => ({
  analyzePosting: analyzePostingMock,
  extractQualifications: extractQualificationsMock,
}));

vi.mock("../jd", () => ({
  fetchPostingJD: fetchPostingJDMock,
}));

import { analyzeLink, LINK_ANALYSIS_TIMEOUT_MS, Posting } from "../posting";

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
    fetchPostingJDMock.mockReset();
    fetchPostingJDMock.mockResolvedValue({ jd: "raw", error: JD_FETCH_OK });
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

  it("uses a supplied fetch result without requesting the JD again", async () => {
    const posting = Posting.from(job);
    const fetched = { jd: "supplied", error: JD_FETCH_OK };
    const timeout = vi.spyOn(AbortSignal, "timeout");
    analyzePostingMock.mockResolvedValue({
      jd: screened,
      rawJD: "supplied",
      cost: 0.1,
      error: JD_FETCH_OK,
    });
    extractQualificationsMock.mockResolvedValue({ qualifications: null, cost: 0 });

    await posting.analyze({ fetched });

    expect(fetchPostingJDMock).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(analyzePostingMock).toHaveBeenCalledWith(expect.objectContaining({ link: job.link }), fetched);
    timeout.mockRestore();
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
    expect(fetchPostingJDMock).toHaveBeenCalledTimes(1);
  });

  it("fetches a bare link once with the short timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    analyzePostingMock.mockResolvedValue({
      jd: null,
      rawJD: "",
      cost: 0,
      error: JD_FETCH_ERROR.noData(),
    });

    await analyzeLink("https://example.com/jobs/bare");

    expect(fetchPostingJDMock).toHaveBeenCalledTimes(1);
    expect(fetchPostingJDMock.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(LINK_ANALYSIS_TIMEOUT_MS);
    expect(timeout).not.toHaveBeenCalledWith(DEFAULT_JD_FETCH_TIMEOUT_MS);
    timeout.mockRestore();
  });
});

describe("Posting.getRawJD", () => {
  beforeEach(() => {
    fetchPostingJDMock.mockReset();
    fetchPostingJDMock.mockResolvedValue({ jd: "raw", error: JD_FETCH_OK });
  });

  it("creates a new default signal on every call", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const posting = Posting.from(job);

    await posting.getRawJD();
    await posting.getRawJD();

    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenNthCalledWith(1, DEFAULT_JD_FETCH_TIMEOUT_MS);
    expect(timeout).toHaveBeenNthCalledWith(2, DEFAULT_JD_FETCH_TIMEOUT_MS);
    expect(fetchPostingJDMock).toHaveBeenCalledTimes(2);
    timeout.mockRestore();
  });

  it("uses an explicit signal without creating the default timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const signal = new AbortController().signal;

    const result = await Posting.from(job).getRawJD(signal);

    expect(timeout).not.toHaveBeenCalled();
    expect(fetchPostingJDMock).toHaveBeenCalledWith(job.link, signal);
    expect(result.jd).toBe("raw");
    timeout.mockRestore();
  });
});
