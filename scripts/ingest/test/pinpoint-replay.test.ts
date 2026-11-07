import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobCategory } from "@/constants/job-category";

import type * as StorePaths from "@/store/paths";
import type { Company, Job } from "@/types";

const paths = vi.hoisted(() => ({ root: "" }));

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
  } satisfies Partial<typeof StorePaths> & Record<string, unknown>;
});

vi.mock("@/modules/employer/build", () => ({
  buildCompanyList: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processJobs } from "../index";

import { getJobKey } from "@/modules/ats/job-key";
import { pinpointJobUrl } from "@/modules/ats/pinpoint";
import { pinpointBoard } from "@/modules/employer/listing/pinpoint";
import {
  classifyPinpointReplay,
  keysExcept,
  PINPOINT_REPLAY_URLS,
  replayKeySet,
} from "@/modules/employer/pinpoint-replay";
import { loadBatchQueue } from "@/modules/posting/batch";
import { opportunities } from "@/store/opportunities";

const APPROVED = "11111111-1111-4111-8111-111111111111";
const KNOWN = "22222222-2222-4222-8222-222222222222";
const FRESH = "33333333-3333-4333-8333-333333333333";

const company: Company = {
  name: "Wolverine",
  ats: "pinpoint",
  identifier: "wolve",
  domain: "https://wolve.pinpointhq.com",
  page: "https://wolve.pinpointhq.com/postings.json",
  urls: [],
};

const jd = {
  citizenship: null,
  sponsorship: null,
  qualifications: ["Bachelor's degree in Computer Science"],
  country: "USA" as const,
  location: "Chicago, IL",
  category: JobCategory.ENTRY_LEVEL,
  season: "None" as const,
};

function posting(id: string, title: string) {
  return {
    id,
    title,
    url: `https://careers.example.com/en/postings/${id}`,
    path: `/en/postings/${id}`,
    location: { name: "Chicago, IL" },
    workplace_type: "onsite",
  };
}

function job(id: string): Job {
  return {
    company: "Wolverine",
    role: "Software Engineer",
    link: pinpointJobUrl("wolve", `/en/postings/${id}`),
    location: "Chicago, IL",
  };
}

const dirs: string[] = [];

describe("Pinpoint replay", () => {
  beforeEach(async () => {
    paths.root = await mkdtemp(path.join(tmpdir(), "jobradar-pinpoint-replay-"));
    dirs.push(paths.root);
    await mkdir(path.join(paths.root, "data"), { recursive: true });
  });

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("keeps the 33 URLs added in 0ccaee30", () => {
    expect(PINPOINT_REPLAY_URLS).toHaveLength(33);
    expect(new Set(PINPOINT_REPLAY_URLS).size).toBe(33);
  });

  it("classifies current rows without treating the old waiting count as current", () => {
    const approved = job(APPROVED);
    const known = job(KNOWN);
    const fresh = job(FRESH);
    const stopped = job("44444444-4444-4444-8444-444444444444");
    const gone = job("55555555-5555-4555-8555-555555555555");
    const valid = job("66666666-6666-4666-8666-666666666666");
    const missing = job("77777777-7777-4777-8777-777777777777");

    const report = classifyPinpointReplay(
      [approved.link, known.link, fresh.link, stopped.link, gone.link, valid.link, missing.link],
      {
        urls: [approved.link, known.link, stopped.link, gone.link],
        companyUrls: [valid.link],
        opportunities: [
          { link: gone.link, expired: true },
          { link: valid.link, jd },
        ],
        queue: [{ link: approved.link }],
        inflight: [],
        results: [],
        failures: [{ key: getJobKey(stopped.link), status: "failed" }],
      }
    );

    expect(Object.fromEntries(report.rows.map((row) => [row.key, row.disposition]))).toEqual({
      [getJobKey(approved.link)]: "in-progress",
      [getJobKey(known.link)]: "replay",
      [getJobKey(fresh.link)]: "confirm-liveness",
      [getJobKey(stopped.link)]: "stopped",
      [getJobKey(gone.link)]: "confirm-liveness",
      [getJobKey(valid.link)]: "valid-jd",
      [getJobKey(missing.link)]: "confirm-liveness",
    });
    expect(report.counts).toEqual({
      replay: 1,
      "in-progress": 1,
      "valid-jd": 1,
      "confirm-liveness": 3,
      stopped: 1,
    });
    expect([...replayKeySet(report.rows)]).toEqual([getJobKey(known.link)]);
  });

  it("reopens only the approved key at the board and does not enqueue it twice", async () => {
    const approved = job(APPROVED);
    const known = job(KNOWN);
    const fresh = job(FRESH);
    const approvedKey = getJobKey(approved.link);
    const knownKey = getJobKey(known.link);
    const freshKey = getJobKey(fresh.link);
    const boardKnown = new Set([approvedKey, knownKey]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          posting(APPROVED, "Software Engineer"),
          posting(KNOWN, "Software Engineer"),
          posting(FRESH, "Software Engineer"),
          posting("88888888-8888-4888-8888-888888888888", "Recruiter"),
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const discovered = await pinpointBoard.fetch(
      company,
      keysExcept(boardKnown, new Set([approvedKey])),
      new AbortController().signal
    );

    expect(discovered.map((item) => getJobKey(item.link)).sort()).toEqual(
      [approvedKey, freshKey].sort()
    );

    const urls = new Set([approved.link, known.link]);
    const ingestKeys = new Set([approvedKey, knownKey]);
    const first = await processJobs({
      jobs: discovered,
      urls,
      keys: keysExcept(ingestKeys, new Set([approvedKey])),
      currentId: 0,
    });

    expect(first.batched).toBe(2);
    expect((await loadBatchQueue()).map((item) => item.link).sort()).toEqual(
      [approved.link, fresh.link].sort()
    );

    const review = classifyPinpointReplay([approved.link, known.link, fresh.link], {
      urls,
      companyUrls: [],
      opportunities: await opportunities.load(),
      queue: await loadBatchQueue(),
      inflight: [],
      results: [],
      failures: [],
    });
    expect(review.rows.find((row) => row.key === approvedKey)?.disposition).toBe("in-progress");
    expect(review.rows.find((row) => row.key === freshKey)?.disposition).toBe("in-progress");
    expect([...replayKeySet(review.rows)]).toEqual([knownKey]);

    const second = await processJobs({
      jobs: [approved, known, fresh],
      urls,
      keys: keysExcept(new Set([approvedKey, knownKey, freshKey]), replayKeySet(review.rows)),
      currentId: 0,
    });

    expect(second.batched).toBe(1);
    expect((await loadBatchQueue()).map((item) => item.link).sort()).toEqual(
      [approved.link, fresh.link, known.link].sort()
    );

    const again = classifyPinpointReplay([approved.link, known.link, fresh.link], {
      urls,
      companyUrls: [],
      opportunities: await opportunities.load(),
      queue: await loadBatchQueue(),
      inflight: [],
      results: [],
      failures: [],
    });
    expect(replayKeySet(again.rows).size).toBe(0);

    const third = await processJobs({
      jobs: [approved, known, fresh],
      urls,
      keys: keysExcept(new Set([approvedKey, knownKey, freshKey]), replayKeySet(again.rows)),
      currentId: 0,
    });

    expect(third.batched).toBe(0);
    expect(await loadBatchQueue()).toHaveLength(3);
    vi.unstubAllGlobals();
  });
});
