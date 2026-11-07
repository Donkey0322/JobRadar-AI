import { promises as nodeFs } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paths = await vi.hoisted(async () => {
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { mkdtemp } = await import("node:fs/promises");
  const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), "jobradar-store-"));
  return { root };
});

vi.mock("@/store/paths", async () => {
  const nodePath = await import("node:path");
  const data = () => nodePath.join(paths.root, "data");

  return {
    get DATA_PATH() {
      return data();
    },
    get URLS_PATH() {
      return nodePath.join(data(), "urls.json");
    },
    get JOB_PATH() {
      return nodePath.join(data(), "jobs.ndjson");
    },
    get OPPORTUNITIES_PATH() {
      return nodePath.join(data(), "opportunities.ndjson");
    },
    get ARCHIVE_PATH() {
      return nodePath.join(data(), "archive");
    },
    get COMPANY_PATH() {
      return nodePath.join(data(), "company.json");
    },
    get ERROR_LOG_PATH() {
      return nodePath.join(data(), "discover-errors.log");
    },
    get BATCH_PATH() {
      return nodePath.join(data(), "batch");
    },
    get BATCH_QUEUE_PATH() {
      return nodePath.join(data(), "batch", "queue.ndjson");
    },
    get BATCH_INFLIGHT_PATH() {
      return nodePath.join(data(), "batch", "inflight.json");
    },
    get BATCH_FAILURES_PATH() {
      return nodePath.join(data(), "batch", "failures.ndjson");
    },
    get BATCH_RESULTS_PATH() {
      return nodePath.join(data(), "batch", "results.ndjson");
    },
    JOB_ARCHIVE_CHUNK: 1000,
    OPPORTUNITY_ARCHIVE_CHUNK: 5000,
  };
});

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { batchInflight, batchQueue, companies, errorLog, jobs, opportunities, urls } from "@/store";
import {
  ARCHIVE_PATH,
  BATCH_INFLIGHT_PATH,
  BATCH_QUEUE_PATH,
  COMPANY_PATH,
  ERROR_LOG_PATH,
  JOB_ARCHIVE_CHUNK,
  JOB_PATH,
  OPPORTUNITIES_PATH,
  URLS_PATH,
} from "@/store/paths";
import { logger } from "@/utils/logger";

function job(id: number) {
  return {
    company: "Acme",
    role: "Engineer",
    link: `https://example.com/jobs/${id}`,
    location: "TX",
  };
}

function ndjson(records: unknown[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

const outsideRepo = [
  URLS_PATH,
  JOB_PATH,
  OPPORTUNITIES_PATH,
  COMPANY_PATH,
  ERROR_LOG_PATH,
  BATCH_QUEUE_PATH,
  BATCH_INFLIGHT_PATH,
  ARCHIVE_PATH,
];

describe("store datasets", () => {
  const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  beforeEach(async () => {
    await rm(path.join(paths.root, "data"), { recursive: true, force: true });
    await mkdir(path.join(paths.root, "data"), { recursive: true });
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    if (tty) {
      Object.defineProperty(process.stdout, "isTTY", tty);
    } else {
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: undefined });
    }
    vi.useRealTimers();
  });

  it("writes every dataset outside the repo", () => {
    for (const filePath of outsideRepo) {
      expect(filePath.startsWith(paths.root)).toBe(true);
      expect(path.relative(process.cwd(), filePath).startsWith("..")).toBe(true);
    }
  });

  it("round-trips urls without changing bytes", async () => {
    await urls.save(new Set(["https://b.example", "https://a.example"]));
    const first = await readFile(URLS_PATH);
    expect(first.toString()).toBe(
      JSON.stringify(["https://a.example", "https://b.example"], null, 2)
    );

    await urls.save(await urls.load());
    expect(await readFile(URLS_PATH)).toEqual(first);
  });

  it("round-trips jobs in file order and keeps append off an empty list", async () => {
    const records = [job(1), job(2)];
    await jobs.replace(records);
    const first = await readFile(JOB_PATH);
    expect(first.toString()).toBe(ndjson(records));

    await jobs.replace(await jobs.loadInFileOrder());
    expect(await readFile(JOB_PATH)).toEqual(first);
    expect(await jobs.load()).toEqual([...records].reverse());

    await jobs.append([]);
    expect(await readFile(JOB_PATH)).toEqual(first);

    await jobs.append([job(3)]);
    expect((await readFile(JOB_PATH)).toString()).toBe(
      `${first.toString()}${JSON.stringify(job(3))}\n`
    );
  });

  it("rotates a full job chunk into the archive and round-trips those bytes", async () => {
    const records = Array.from({ length: JOB_ARCHIVE_CHUNK + 1 }, (_, index) => job(index));
    await jobs.append(records);

    const archived = await readFile(path.join(ARCHIVE_PATH, "jobs-001.ndjson"));
    const hot = await readFile(JOB_PATH);
    expect(archived.toString()).toBe(ndjson(records.slice(0, JOB_ARCHIVE_CHUNK)));
    expect(hot.toString()).toBe(ndjson(records.slice(JOB_ARCHIVE_CHUNK)));

    const loaded = await jobs.loadInFileOrder();
    await jobs.replace(loaded);
    expect(await readFile(path.join(ARCHIVE_PATH, "jobs-001.ndjson"))).toEqual(archived);
    expect(await readFile(JOB_PATH)).toEqual(hot);
    expect(loaded).toEqual(records);
  });

  it("round-trips opportunities and leaves the file untouched on an empty append", async () => {
    const firstRecord = { ...job(1), postedAt: "2026-01-01T00:00:00.000Z", expired: false };
    const secondRecord = { ...job(2), postedAt: "2026-01-02T00:00:00.000Z", expired: false };
    await opportunities.replace([firstRecord, secondRecord]);
    const first = await readFile(OPPORTUNITIES_PATH);

    await opportunities.replace(await opportunities.load());
    expect(await readFile(OPPORTUNITIES_PATH)).toEqual(first);

    await opportunities.append([]);
    expect(await readFile(OPPORTUNITIES_PATH)).toEqual(first);

    await opportunities.append([secondRecord]);
    expect((await readFile(OPPORTUNITIES_PATH)).toString()).toBe(
      `${first.toString()}${JSON.stringify(secondRecord)}\n`
    );
    await expect(rm(path.join(ARCHIVE_PATH, "opportunities-001.ndjson"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("writes an empty job file on replace and skips creating one on append", async () => {
    await jobs.append([]);
    await expect(readFile(JOB_PATH)).rejects.toMatchObject({ code: "ENOENT" });

    await jobs.replace([]);
    expect(await readFile(JOB_PATH, "utf8")).toBe("");
  });

  it("round-trips companies", async () => {
    const stored = [
      {
        name: "Acme",
        ats: "greenhouse" as const,
        identifier: "acme",
        domain: "https://boards.greenhouse.io",
        page: "https://boards.greenhouse.io/acme",
        urls: ["https://example.com/jobs/1"],
      },
    ];
    await companies.save(stored);
    const first = await readFile(COMPANY_PATH);
    expect(first.toString()).toBe(JSON.stringify(stored, null, 2));

    await companies.save(await companies.load());
    expect(await readFile(COMPANY_PATH)).toEqual(first);
  });

  it("appends error-log lines only when stdout is a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    await errorLog.append("hidden");
    await expect(readFile(ERROR_LOG_PATH)).rejects.toMatchObject({ code: "ENOENT" });
    expect(logger.warn).toHaveBeenCalledWith("hidden");

    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
    await errorLog.append("first");
    vi.setSystemTime(new Date("2026-01-02T03:04:06.000Z"));
    await errorLog.append("second");

    const body = await readFile(ERROR_LOG_PATH, "utf8");
    expect(body).toBe("2026-01-02T03:04:05.000Z first\n2026-01-02T03:04:06.000Z second\n");
  });

  it("round-trips the batch queue", async () => {
    const queued = [job(1), job(2)];
    await batchQueue.save(queued);
    const first = await readFile(BATCH_QUEUE_PATH);
    expect(first.toString()).toBe(ndjson(queued));

    await batchQueue.save(await batchQueue.load());
    expect(await readFile(BATCH_QUEUE_PATH)).toEqual(first);

    await batchQueue.save([]);
    expect(await readFile(BATCH_QUEUE_PATH, "utf8")).toBe("");
  });

  it("round-trips inflight batches", async () => {
    const batches = [
      {
        name: "batches/1",
        submittedAt: "2026-01-01T00:00:00.000Z",
        jobs: [job(1)],
      },
    ];
    await batchInflight.save(batches);
    const first = await readFile(BATCH_INFLIGHT_PATH);
    expect(first.toString()).toBe(`${JSON.stringify(batches, null, 2)}\n`);

    await batchInflight.save(await batchInflight.load());
    expect(await readFile(BATCH_INFLIGHT_PATH)).toEqual(first);
  });

  it("treats a missing inflight file as an empty list", async () => {
    expect(await batchInflight.load()).toEqual([]);
  });

  it("keeps the previous inflight list when the temp write fails before replace", async () => {
    const batches = [
      {
        name: "batches/kept",
        submittedAt: "2026-01-01T00:00:00.000Z",
        jobs: [job(1)],
      },
    ];
    await batchInflight.save(batches);
    const before = await readFile(BATCH_INFLIGHT_PATH, "utf8");
    const write = vi.spyOn(nodeFs, "writeFile").mockRejectedValue(new Error("injected temp write failure"));

    await expect(
      batchInflight.save([
        {
          name: "batches/lost",
          submittedAt: "2026-01-02T00:00:00.000Z",
          jobs: [],
        },
      ])
    ).rejects.toThrow("injected temp write failure");
    write.mockRestore();

    expect(await readFile(BATCH_INFLIGHT_PATH, "utf8")).toBe(before);
    expect(await batchInflight.load()).toEqual(batches);
  });

  it("reports a damaged inflight file and leaves the original bytes in place", async () => {
    await mkdir(path.dirname(BATCH_INFLIGHT_PATH), { recursive: true });
    const damaged = "{not-json";
    await writeFile(BATCH_INFLIGHT_PATH, damaged);

    await expect(batchInflight.load()).rejects.toThrow(
      `Inflight batch file is not valid JSON: ${BATCH_INFLIGHT_PATH}`
    );
    expect(await readFile(BATCH_INFLIGHT_PATH, "utf8")).toBe(damaged);

    const notArray = `${JSON.stringify({ name: "batches/1" })}\n`;
    await writeFile(BATCH_INFLIGHT_PATH, notArray);
    await expect(batchInflight.load()).rejects.toThrow(
      `Inflight batch file must be a JSON array: ${BATCH_INFLIGHT_PATH}`
    );
    expect(await readFile(BATCH_INFLIGHT_PATH, "utf8")).toBe(notArray);
  });
});

afterAll(async () => {
  await rm(paths.root, { recursive: true, force: true });
});
