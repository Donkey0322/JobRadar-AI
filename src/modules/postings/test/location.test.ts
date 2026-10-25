import { beforeEach, describe, expect, it, vi } from "vitest";

const callAIModelMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/ai", () => ({
  default: callAIModelMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { Job } from "@/types";

import { classifyLocations } from "../location";

import { getCountryRules } from "@/modules/country";

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
});
