import { afterEach, describe, expect, it, vi } from "vitest";

import type * as AI from "@/utils/ai";

vi.hoisted(() => {
  process.env.AI_API_KEY = "test-fake-ai-key";
  process.env.SMTP_PASS = "test-fake-smtp-pass";
  process.env.PAT = "test-fake-pat";
});

const checks = vi.hoisted(() => ({
  validateModel: vi.fn(async () => undefined),
  verify: vi.fn(async () => true),
}));

vi.mock("@/utils/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof AI>();
  return {
    ...actual,
    getProvider: () => ({
      validateModel: checks.validateModel,
      generate: vi.fn(),
    }),
  };
});

vi.mock("../../utils/mail", () => ({
  createSMTPTransport: () => ({ verify: checks.verify }),
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { CONFIG } from "@/config";

describe("jobctl setup check-config", () => {
  const previousArgv = process.argv.slice();

  afterEach(() => {
    process.argv = previousArgv;
    delete process.env.AI_MODE;
  });

  it("loads the command and runs the AI, SMTP, and GitHub checks", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit ${code ?? ""}`);
    }) as typeof process.exit);
    process.argv = ["node", "jobradar", "setup", "check-config"];

    await import("../index");
    const ai = CONFIG.ai;
    if (!ai.enabled) {
      throw new Error("config.ai.enabled must stay on for this check");
    }
    await vi.waitFor(
      () => {
        expect(checks.validateModel).toHaveBeenCalledWith(ai.model);
        expect(checks.verify).toHaveBeenCalledOnce();
      },
      { timeout: 5_000 }
    );

    expect(exit).not.toHaveBeenCalled();
    expect(process.env.AI_MODE).toBe("ON");
  });
});
