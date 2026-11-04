import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { CONFIG } from "@/constants";

const callAIModelMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/ai", () => ({
  default: callAIModelMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { Job } from "@/types";

import { getCountryRules } from "../country";
import { classifyLocations } from "../location";

const job: Job = {
  company: "Acme",
  role: "Software Engineer",
  link: "https://example.com/1",
  location: "Aguadilla, Puerto Rico",
};

describe("classifyLocations", () => {
  beforeEach(() => {
    callAIModelMock.mockReset();
    process.env.AI_MODE = "ON";
  });

  it("uses the shared country rules", async () => {
    callAIModelMock.mockResolvedValue({ result: JSON.stringify(["USA"]), cost: 0 });

    await expect(classifyLocations([job])).resolves.toEqual(["USA"]);

    const options = callAIModelMock.mock.calls[0]?.[2] as { systemInstruction: string };
    expect(options.systemInstruction).toContain(await getCountryRules());
  });

  it("returns Unsure without calling AI when AI is disabled in config", async () => {
    const ai = CONFIG.ai;
    CONFIG.ai = { enabled: false };
    onTestFinished(() => {
      CONFIG.ai = ai;
    });

    await expect(classifyLocations([job])).resolves.toEqual(["Unsure"]);
    expect(callAIModelMock).not.toHaveBeenCalled();
  });
});
