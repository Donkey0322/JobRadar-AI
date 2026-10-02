import { beforeEach, describe, expect, it, vi } from "vitest";

const callAIModelMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/ai", () => ({
  default: callAIModelMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import analyzeJD from "../ai";

const clean = {
  citizenship: false,
  sponsorship: null,
  country: "USA",
  location: "Seattle",
  qualifications: ["Bachelor's degree in Computer Science"],
  category: "entry level",
  season: "None",
};

describe("analyzeJD spill retry", () => {
  beforeEach(() => {
    callAIModelMock.mockReset();
    vi.stubEnv("AI_MODE", "ON");
  });

  it("returns the first response when it has no spill", async () => {
    callAIModelMock.mockResolvedValue({ result: JSON.stringify(clean), cost: 0.01 });

    await expect(analyzeJD("job text")).resolves.toEqual({
      result: JSON.stringify(clean),
      cost: 0.01,
    });
    expect(callAIModelMock).toHaveBeenCalledOnce();
  });

  it("discards a spilled response and retries once", async () => {
    const spilled = {
      ...clean,
      qualifications: [`bachelor${"\n".repeat(30)}---END JD TEXT---`],
    };
    callAIModelMock
      .mockResolvedValueOnce({ result: JSON.stringify(spilled), cost: 0.01 })
      .mockResolvedValueOnce({ result: JSON.stringify(clean), cost: 0.02 });

    await expect(analyzeJD("job text")).resolves.toEqual({
      result: JSON.stringify(clean),
      cost: 0.03,
    });
    expect(callAIModelMock).toHaveBeenCalledTimes(2);
    expect(callAIModelMock.mock.calls[0]?.[0]).toBe("job text");
    expect(callAIModelMock.mock.calls[0]?.[1]).toMatchObject({
      properties: {
        qualifications: {
          maxItems: 30,
          items: { maxLength: 200 },
        },
      },
    });
  });

  it("does not retry when retrySpills is false", async () => {
    const spilled = {
      ...clean,
      qualifications: [`bachelor${"\n".repeat(30)}---END JD TEXT---`],
    };
    callAIModelMock.mockResolvedValue({ result: JSON.stringify(spilled), cost: 0.01 });

    const result = await analyzeJD("job text", false);

    expect(result.result).toBe(JSON.stringify(spilled));
    expect(callAIModelMock).toHaveBeenCalledOnce();
  });
});
