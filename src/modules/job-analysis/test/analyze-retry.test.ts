import { beforeEach, describe, expect, it, vi } from "vitest";

const callAIModelMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/ai", () => ({
  default: callAIModelMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import analyzeJD, {
  analyzeQualifications,
  formatQualificationPrompt,
  getAnalyzeJDConfig,
  getQualificationConfig,
} from "../ai";

const screen = {
  citizenship: false,
  sponsorship: null,
  country: "USA",
  location: "Seattle",
  category: "entry level",
  season: "None",
};

describe("analyzeJD spill retry", () => {
  beforeEach(() => {
    callAIModelMock.mockReset();
    vi.stubEnv("AI_MODE", "ON");
  });

  it("returns the first response when it has no spill", async () => {
    callAIModelMock.mockResolvedValue({ result: JSON.stringify(screen), cost: 0.01 });

    await expect(analyzeJD("job text")).resolves.toEqual({
      result: JSON.stringify(screen),
      cost: 0.01,
    });
    expect(callAIModelMock).toHaveBeenCalledOnce();
    expect(callAIModelMock.mock.calls[0]?.[1]).not.toHaveProperty("properties.qualifications");
  });

  it("discards a spilled screening response and retries once", async () => {
    const spilled = {
      ...screen,
      location: `Seattle${"\n".repeat(30)}---END JD TEXT---`,
    };
    callAIModelMock
      .mockResolvedValueOnce({ result: JSON.stringify(spilled), cost: 0.01 })
      .mockResolvedValueOnce({ result: JSON.stringify(screen), cost: 0.02 });

    await expect(analyzeJD("job text")).resolves.toEqual({
      result: JSON.stringify(screen),
      cost: 0.03,
    });
    expect(callAIModelMock).toHaveBeenCalledTimes(2);
    expect(callAIModelMock.mock.calls[0]?.[0]).toBe("job text");
    expect(callAIModelMock.mock.calls[1]?.[0]).toBe("job text");
  });

  it("does not retry when retrySpills is false", async () => {
    const spilled = {
      ...screen,
      location: `Seattle${"\n".repeat(30)}---END JD TEXT---`,
    };
    callAIModelMock.mockResolvedValue({ result: JSON.stringify(spilled), cost: 0.01 });

    const result = await analyzeJD("job text", false);

    expect(result.result).toBe(JSON.stringify(spilled));
    expect(callAIModelMock).toHaveBeenCalledOnce();
  });

  it("retries a spilled qualification response with the JD still leading the prompt", async () => {
    const spilled = {
      qualifications: [`bachelor${"\n".repeat(30)}---END JD TEXT---`],
    };
    const clean = { qualifications: ["Bachelor's degree in Computer Science"] };
    callAIModelMock
      .mockResolvedValueOnce({ result: JSON.stringify(spilled), cost: 0.01 })
      .mockResolvedValueOnce({ result: JSON.stringify(clean), cost: 0.02 });

    await expect(analyzeQualifications("job text")).resolves.toEqual({
      result: JSON.stringify(clean),
      cost: 0.03,
    });
    expect(callAIModelMock.mock.calls[0]?.[0]).toBe(formatQualificationPrompt("job text"));
    expect(callAIModelMock.mock.calls[0]?.[0]).toMatch(
      /^job text\n\nExtract qualifications only\.$/
    );
    expect(callAIModelMock.mock.calls[0]?.[1]).toMatchObject({
      required: ["qualifications"],
      properties: {
        qualifications: {
          maxItems: 30,
          items: { maxLength: 200 },
        },
      },
    });
  });

  it("reuses one system instruction for screening and qualifications", async () => {
    const screening = await getAnalyzeJDConfig();
    const qualifications = await getQualificationConfig();

    expect(qualifications.systemInstruction).toBe(screening.systemInstruction);
    expect(screening.schema).not.toHaveProperty("properties.qualifications");
    expect(qualifications.schema).toHaveProperty("properties.qualifications");
  });
});
