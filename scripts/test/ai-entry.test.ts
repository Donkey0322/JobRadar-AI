import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobCategory } from "@/constants/job-category";

import type * as ConfigModule from "@/config";

type AIConfig = ConfigModule.Config["ai"];

const FAKE_API_KEY = "test-fake-ai-key";
const JOB_URL = "https://careers.example.com/jobs/123";
const ENABLED_CONFIG = {
  enabled: true,
  provider: "anthropic",
  model: "claude-test-model",
} as const satisfies AIConfig;

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

const dataMocks = vi.hoisted(() => ({
  readJsonFile: vi.fn(),
  urls: { load: vi.fn(), save: vi.fn() },
  jobs: { load: vi.fn(), append: vi.fn() },
  opportunities: { load: vi.fn(), append: vi.fn(), replace: vi.fn() },
}));

const enqueueBatchJobsMock = vi.hoisted(() => vi.fn());
const buildCompanyListMock = vi.hoisted(() => vi.fn());
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

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

vi.mock("@/store", () => dataMocks);

vi.mock("@/modules/posting/batch", () => ({
  enqueueBatchJobs: enqueueBatchJobsMock,
}));

vi.mock("@/modules/employer/build", () => ({
  buildCompanyList: buildCompanyListMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: loggerMocks,
}));

const screenResult = {
  citizenship: null,
  sponsorship: null,
  country: "USA",
  location: "Austin, TX, USA",
  category: JobCategory.ENTRY_LEVEL,
  season: "None",
};

const fetchMock = vi.fn<typeof fetch>(
  async () =>
    new Response(
      "<html><body><h1>Marketing Manager</h1><p>Acme is hiring in Austin, TX.</p></body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    )
);

function fetchedUrls() {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

function loggedMessages(mock: typeof loggerMocks.info) {
  return mock.mock.calls.map((args) => args.find((arg) => typeof arg === "string"));
}

async function runScript(path: string, config: AIConfig) {
  ai.config.current = config;
  vi.resetModules();
  await import(path);
}

describe("AI entry points", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const argv = process.argv;

  beforeEach(() => {
    ai.created.length = 0;
    ai.generate.mockReset().mockImplementation(async (_prompt, schema) => {
      const wantsQualifications = "qualifications" in (schema.properties ?? {});
      const result = wantsQualifications ? { qualifications: ["Marketing degree"] } : screenResult;
      return { result: JSON.stringify(result), cost: 0.01 };
    });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_API_KEY", FAKE_API_KEY);
    vi.stubEnv("AI_MODE", undefined);
    vi.stubEnv("GITHUB_EVENT_PATH", "/nonexistent/event.json");

    dataMocks.readJsonFile.mockReset().mockResolvedValue({
      issue: {
        number: 1,
        title: "Add job",
        body: [
          "### Company",
          "Acme",
          "### Role",
          "Marketing Manager",
          "### Link",
          JOB_URL,
          "### Location",
          "Austin, TX",
        ].join("\n\n"),
      },
    });
    dataMocks.urls.load.mockReset().mockResolvedValue(new Set<string>());
    dataMocks.jobs.load.mockReset().mockResolvedValue([]);
    dataMocks.opportunities.load.mockReset().mockResolvedValue([]);
    dataMocks.urls.save.mockReset().mockResolvedValue(undefined);
    dataMocks.jobs.append.mockReset().mockResolvedValue(undefined);
    dataMocks.opportunities.append.mockReset().mockResolvedValue(undefined);
    dataMocks.opportunities.replace.mockReset().mockResolvedValue(undefined);
    enqueueBatchJobsMock.mockReset().mockResolvedValue(undefined);
    buildCompanyListMock.mockReset().mockResolvedValue(undefined);
    for (const mock of Object.values(loggerMocks)) mock.mockReset();

    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = argv;
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("add-job-from-issue", () => {
    async function runIssue(config: AIConfig) {
      await runScript("../add-job-from-issue", config);
      await vi.waitFor(() => {
        expect(loggedMessages(loggerMocks.info)).toContain("Processed submitted job:");
      });
    }

    it("skips analysis without creating a provider or calling AI when AI is disabled", async () => {
      await runIssue({ enabled: false });

      expect(ai.created).toEqual([]);
      expect(ai.generate).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(loggedMessages(loggerMocks.info)).toContain("⏭️ AI is disabled; skipping analysis");
      expect(loggerMocks.error).not.toHaveBeenCalled();
      expect(enqueueBatchJobsMock).not.toHaveBeenCalled();
      expect(dataMocks.urls.save).toHaveBeenCalledWith(new Set());
      expect(dataMocks.jobs.append).toHaveBeenCalledWith([]);
      expect(buildCompanyListMock).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("analyzes with the configured provider and model when AI is enabled", async () => {
      await runIssue(ENABLED_CONFIG);

      expect(fetchedUrls()).toEqual([JOB_URL]);
      expect(ai.created.length).toBeGreaterThan(0);
      expect(ai.created).toEqual(
        ai.created.map(() => ({ provider: ENABLED_CONFIG.provider, apiKey: FAKE_API_KEY }))
      );
      expect(ai.generate).toHaveBeenCalled();
      for (const call of ai.generate.mock.calls) {
        expect(call[2]).toBe(ENABLED_CONFIG.model);
      }
      expect(enqueueBatchJobsMock).not.toHaveBeenCalled();
      expect(dataMocks.urls.save).toHaveBeenCalledWith(new Set([JOB_URL]));
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("job analyze -l", () => {
    async function runLink(config: AIConfig) {
      ai.config.current = config;
      vi.resetModules();
      const { analyzeJobs } = await import("../link");
      await analyzeJobs([JOB_URL]);
    }

    it("returns no result without creating a provider or calling AI when AI is disabled", async () => {
      await runLink({ enabled: false });

      expect(ai.created).toEqual([]);
      expect(ai.generate).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(loggedMessages(loggerMocks.info)).toContain(
        "⏭️ AI is disabled; skipping link analysis"
      );
      expect(loggerMocks.error).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("analyzes with the configured provider and model when AI is enabled", async () => {
      await runLink(ENABLED_CONFIG);

      expect(fetchedUrls()).toEqual([JOB_URL]);
      expect(ai.created.length).toBeGreaterThan(0);
      expect(ai.created).toEqual(
        ai.created.map(() => ({ provider: ENABLED_CONFIG.provider, apiKey: FAKE_API_KEY }))
      );
      for (const call of ai.generate.mock.calls) {
        expect(call[2]).toBe(ENABLED_CONFIG.model);
      }
      expect(loggedMessages(loggerMocks.info)).toContain("\n ✏️ Result:\n%s");
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
