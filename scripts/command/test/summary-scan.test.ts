import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchEmployerJobs = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ jobs: unknown[]; slow: unknown[]; failed: unknown[] }> => ({
      jobs: [],
      slow: [],
      failed: [],
    })
  )
);
const classifyLocations = vi.hoisted(() => vi.fn(async (): Promise<Array<string | null>> => []));
const processJobs = vi.hoisted(() => vi.fn());
const createSyncContext = vi.hoisted(() =>
  vi.fn(async () => ({ urls: new Set<string>(), keys: new Set<string>(), currentId: 0 }))
);
const companies = vi.hoisted(() => vi.fn(async (): Promise<Array<{ company: string }>> => []));
const fetchSource = vi.hoisted(() => vi.fn(async (): Promise<Array<Record<string, string>>> => []));

vi.mock("@/modules/employer/discover", () => ({ fetchEmployerJobs }));
vi.mock("@/modules/employer/registry", () => ({ asBoard: (company: unknown) => company }));
vi.mock("@/modules/posting/analysis/location", () => ({ classifyLocations }));
vi.mock("@/store", () => ({ companies: { load: companies } }));
vi.mock("../../ingest", () => ({ processJobs, createSyncContext }));
vi.mock("@/modules/source", () => ({
  default: fetchSource,
  SOURCES: [{ name: "Example", url: "https://example.com/feed", disabled: false }],
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { renderSummary } from "../../../.github/scripts/summary.mjs";
import syncDiscover from "../scan";
import syncCommunity from "../sync";

const temps: string[] = [];

afterEach(() => {
  delete process.env.JOBRADAR_SUMMARY_DIR;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function summaryDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "jobradar-summary-scan-"));
  temps.push(dir);
  process.env.JOBRADAR_SUMMARY_DIR = dir;
  return dir;
}

function processed(overrides: Record<string, unknown> = {}) {
  return {
    count: 0,
    received: 0,
    opportunitiesAdded: 0,
    skipped: 0,
    skipReasons: {},
    failed: 0,
    batched: 0,
    notStarted: 0,
    totalCost: 0,
    forceStopped: false,
    jobs: [],
    ...overrides,
  };
}

describe("scan and sync summaries", () => {
  it("records an empty scan as measured zeros", async () => {
    const dir = summaryDir();
    companies.mockResolvedValue([{ company: "Acme" }, { company: "Beta" }]);
    fetchEmployerJobs.mockResolvedValue({ jobs: [], slow: [], failed: [] });
    classifyLocations.mockResolvedValue([]);
    processJobs.mockResolvedValue(processed());

    await syncDiscover();

    const { markdown } = renderSummary({
      dir,
      summaryPath: path.join(dir, "summary.md"),
    });
    expect(markdown).toContain("### Jobs (scan)");
    expect(markdown).toContain("| Status | success |");
    expect(markdown).toContain("| Companies | 2 |");
    expect(markdown).toContain("| Discovered | 0 |");
    expect(markdown).toContain("| Jobs added | 0 |");
    expect(markdown).toContain("| Opportunities added | 0 |");
    expect(markdown).toContain("| Queued for batch | 0 |");
    expect(markdown).toContain("| Written locally | complete |");
    expect(markdown).not.toContain("skipped");
  });

  it("keeps discovered, saved, and failed listings distinct when analysis is partial", async () => {
    const dir = summaryDir();
    companies.mockResolvedValue([{ company: "Acme" }]);
    fetchEmployerJobs.mockResolvedValue({
      jobs: [{ company: "Acme" }, { company: "Acme" }, { company: "Acme" }],
      slow: [{}],
      failed: [{ company: "Down" }],
    });
    classifyLocations.mockResolvedValue([null, null, null]);
    processJobs.mockResolvedValue(
      processed({
        count: 1,
        received: 3,
        opportunitiesAdded: 2,
        skipped: 1,
        skipReasons: { filter: 1 },
        failed: 1,
        batched: 1,
      })
    );

    await syncDiscover();

    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("| Status | partial |");
    expect(markdown).toContain("| Discovered | 3 |");
    expect(markdown).toContain("| Listing failures | 1 |");
    expect(markdown).toContain("| Slow listings | 1 |");
    expect(markdown).toContain("| Processed | 3 |");
    expect(markdown).toContain("| Jobs added | 1 |");
    expect(markdown).toContain("| Opportunities added | 2 |");
    expect(markdown).toContain("| Skipped | 1 |");
    expect(markdown).toContain("| Queued for batch | 1 |");
    expect(markdown).toContain("| Analysis failures | 1 |");
    expect(markdown).not.toContain("Down");
  });

  it("marks the scan partial when a listing failed and analysis succeeded", async () => {
    const dir = summaryDir();
    companies.mockResolvedValue([{ company: "Acme" }]);
    fetchEmployerJobs.mockResolvedValue({
      jobs: [{ company: "Acme" }],
      slow: [],
      failed: [{ company: "Down" }],
    });
    classifyLocations.mockResolvedValue([null]);
    processJobs.mockResolvedValue(
      processed({ count: 1, received: 1, opportunitiesAdded: 1, failed: 0 })
    );

    await syncDiscover();

    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("| Status | partial |");
    expect(markdown).toContain("| Listing failures | 1 |");
    expect(markdown).toContain("| Analysis failures | 0 |");
    expect(markdown).toContain("| Jobs added | 1 |");
    expect(markdown).not.toContain("Down");
  });

  it("records a scan failure without treating discovered listings as saved jobs", async () => {
    const dir = summaryDir();
    companies.mockResolvedValue([{ company: "Acme" }]);
    fetchEmployerJobs.mockResolvedValue({ jobs: [{ company: "Acme" }], slow: [], failed: [] });
    classifyLocations.mockResolvedValue([null]);
    processJobs.mockRejectedValue(new Error("sk-live-secret"));

    await expect(syncDiscover()).rejects.toThrow("sk-live-secret");

    const raw = readFileSync(path.join(dir, "stages.ndjson"), "utf8");
    expect(raw).not.toContain("sk-live-secret");
    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("| Status | failed |");
    expect(markdown).toContain("| Discovered | 1 |");
    expect(markdown).toContain("| Written locally | unknown |");
    expect(markdown).not.toContain("Jobs added");
    expect(markdown).not.toContain("sk-live-secret");
  });

  it("records sync fetch counts separately from jobs added", async () => {
    const dir = summaryDir();
    companies.mockResolvedValue([]);
    fetchSource.mockResolvedValue([
      { company: "Acme", role: "Secret Role", link: "https://example.com/secret-jd" },
    ]);
    processJobs.mockResolvedValue(
      processed({ count: 0, received: 0, skipped: 1, skipReasons: { idempotent: 1 } })
    );

    await syncCommunity();

    const raw = readFileSync(path.join(dir, "stages.ndjson"), "utf8");
    expect(raw).not.toContain("Secret Role");
    expect(raw).not.toContain("secret-jd");
    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("### Jobs (sync)");
    expect(markdown).toContain("| Sources | 1 |");
    expect(markdown).toContain("| Fetched | 1 |");
    expect(markdown).toContain("| Jobs added | 0 |");
    expect(markdown).not.toContain("Secret Role");
  });
});
