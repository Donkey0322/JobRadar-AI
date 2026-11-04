import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConfigModule from "@/config";

type AIConfig = ConfigModule.Config["ai"];

const FAKE_API_KEY = "test-fake-ai-key";

const ai = vi.hoisted(() => {
  const created: Array<{ provider: string; apiKey: string }> = [];
  const generate = vi.fn();
  const config: { current: unknown } = { current: { enabled: false } };

  function fakeProvider(provider: string) {
    return class {
      generate = generate;
      validateModel = vi.fn();

      constructor(apiKey: string) {
        created.push({ provider, apiKey });
      }
    };
  }

  return { created, generate, config, fakeProvider };
});

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    ...actual,
    CONFIG: {
      ...actual.CONFIG,
      get ai() {
        return ai.config.current;
      },
    },
  };
});

vi.mock("@/utils/ai/provider/google", () => ({ GoogleProvider: ai.fakeProvider("google") }));
vi.mock("@/utils/ai/provider/openai", () => ({ OpenAIProvider: ai.fakeProvider("openai") }));
vi.mock("@/utils/ai/provider/anthropic", () => ({
  AnthropicProvider: ai.fakeProvider("anthropic"),
}));

const fetchMock = vi.fn();

async function loadAI(config: AIConfig) {
  ai.config.current = config;
  vi.resetModules();
  return import("@/utils/ai");
}

describe("AI enabled gate", () => {
  beforeEach(() => {
    ai.created.length = 0;
    ai.generate.mockReset().mockResolvedValue({ result: '{"ok":true}', cost: 0.01 });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_API_KEY", FAKE_API_KEY);
    vi.stubEnv("AI_MODE", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates no provider and sends no request when config disables AI and AI_MODE is unset", async () => {
    const { default: callAIModel, getAIProvider, getProvider } = await loadAI({ enabled: false });

    await expect(callAIModel("prompt", { type: "object" })).resolves.toEqual({
      result: null,
      cost: 0,
    });
    expect(getAIProvider()).toBeNull();
    expect(getProvider(FAKE_API_KEY)).toBeNull();
    expect(ai.created).toEqual([]);
    expect(ai.generate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores AI_MODE=ON when config disables AI", async () => {
    vi.stubEnv("AI_MODE", "ON");
    const { default: callAIModel, getAIProvider } = await loadAI({ enabled: false });

    await callAIModel("prompt", { type: "object" });

    expect(getAIProvider()).toBeNull();
    expect(ai.created).toEqual([]);
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "google", model: "gemini-test-model" },
    { provider: "anthropic", model: "claude-test-model" },
    { provider: "openai", model: "gpt-test-model" },
  ] as const)("uses the configured $provider provider and model when enabled", async (config) => {
    const { default: callAIModel, getAIProvider } = await loadAI({ enabled: true, ...config });

    await expect(callAIModel("prompt", { type: "object" })).resolves.toEqual({
      result: '{"ok":true}',
      cost: 0.01,
    });
    expect(getAIProvider()).not.toBeNull();
    expect(ai.created).toEqual([
      { provider: config.provider, apiKey: FAKE_API_KEY },
      { provider: config.provider, apiKey: FAKE_API_KEY },
    ]);
    expect(ai.generate).toHaveBeenCalledOnce();
    expect(ai.generate.mock.calls[0]?.[2]).toBe(config.model);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps AI_MODE=DOWN as an off switch when config enables AI", async () => {
    vi.stubEnv("AI_MODE", "DOWN");
    const { default: callAIModel, getAIProvider } = await loadAI({
      enabled: true,
      provider: "google",
      model: "gemini-test-model",
    });

    await callAIModel("prompt", { type: "object" });

    expect(getAIProvider()).toBeNull();
    expect(ai.created).toEqual([]);
    expect(ai.generate).not.toHaveBeenCalled();
  });
});
