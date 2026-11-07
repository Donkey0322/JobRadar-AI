import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as StorePaths from "@/store/paths";
import type { Job, Opportunity } from "@/types";
import type { JD } from "@/types/jobs";
import type * as AI from "@/utils/ai";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PROGRAM = path.join(ROOT, "scripts/github/recover-batch.ts");
const ROUTE = path.join(ROOT, ".github/scripts/workflow-route.mjs");

const paths = await vi.hoisted(async () => {
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { mkdtemp } = await import("node:fs/promises");

  return { root: await mkdtemp(nodePath.join(nodeOs.tmpdir(), "jobradar-recover-unused-")) };
});

const provider = vi.hoisted(() => {
  const batches = new Map<string, { state: "succeeded"; durationMs: number; results: unknown[] }>();

  return {
    batches,
    generate: vi.fn(() => {
      throw new Error("recovery rerun called AI");
    }),
    submitBatch: vi.fn(() => {
      throw new Error("recovery rerun submitted a batch");
    }),
    getBatch: vi.fn(async (name: string) => {
      const status = batches.get(name);
      if (!status) throw new Error(`Unknown batch ${name}`);
      return status;
    }),
  };
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
  } satisfies Partial<typeof StorePaths> & Record<string, unknown>;
});

vi.mock("@/utils/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof AI>();

  return {
    ...actual,
    default: () => provider.generate(),
    getAIProvider: () => ({
      generate: provider.generate,
      validateModel: vi.fn(),
      submitBatch: provider.submitBatch,
      getBatch: provider.getBatch,
    }),
  };
});

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { JobCategory } from "@/constants/job-category";

import { routePush } from "../../../.github/scripts/workflow-route.mjs";
import { processBatchQueue } from "../../command/batch";
import { planBatchRecovery } from "../recover-batch";

import { CONFIG } from "@/config";
import { getJobKey } from "@/modules/ats/job-key";
import { opportunityStopSaved } from "@/modules/opportunity/stop";
import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/posting/jd";
import { Posting } from "@/modules/posting/posting";

const temps: string[] = [];
const ai = CONFIG.ai;

function gitEnv() {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;

  return {
    ...env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "actions-bot",
    GIT_AUTHOR_EMAIL: "actions@github.com",
    GIT_COMMITTER_NAME: "actions-bot",
    GIT_COMMITTER_EMAIL: "actions@github.com",
  };
}

function git(cwd: string, args: string[]) {
  const result = spawnSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args],
    {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
    }
  );

  if (result.status !== 0) {
    throw new Error(`${args.join(" ")}\n${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function recover(repo: string) {
  return spawnSync(process.execPath, ["--import", "tsx", PROGRAM, repo], {
    cwd: ROOT,
    encoding: "utf8",
    env: gitEnv(),
    maxBuffer: 8 * 1024 * 1024,
  });
}

function jd(location: string, qualifications: string[] | null = ["Bachelor's degree"]): JD {
  return {
    citizenship: false,
    sponsorship: true,
    qualifications,
    country: "USA",
    location,
    category: JobCategory.SUMMER_INTERN,
    season: "None",
  };
}

function listing(company: string, id: string): Job {
  return {
    company,
    role: "Software Engineer Intern",
    link: `https://job-boards.greenhouse.io/${company.toLowerCase()}/jobs/${id}`,
    location: "Austin, TX",
  };
}

const alpha = listing("Alpha", "101");
const beta = listing("Beta", "202");

function ndjson(records: unknown[]) {
  return records.length === 0
    ? ""
    : `${records.map((record) => `${JSON.stringify(record)}\n`).join("")}`;
}

function readNdjson<T>(file: string): T[] {
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function pending(job: Job, body: JD, cost: number) {
  return {
    key: getJobKey(job.link),
    job: { company: job.company, role: job.role, link: job.link, location: job.location },
    jd: body,
    attemptId: `realtime:${job.company.toLowerCase()}-attempt`,
    cost,
    analyzedAt: "2026-11-07T09:00:00.000Z",
  };
}

function stored(job: Job, id: number, body: JD) {
  return {
    id,
    company: job.company,
    role: job.role,
    link: job.link,
    location: job.location,
    jd: body,
  };
}

function writeBatch(repo: string, files: Record<string, string>) {
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(repo, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}

function initRepo() {
  const parent = mkdtempSync(path.join(tmpdir(), "jobradar-recover-"));
  temps.push(parent);
  const origin = path.join(parent, "origin.git");
  const work = path.join(parent, "work");
  git(parent, ["init", "--bare", "-b", "main", origin]);
  git(parent, ["init", "-b", "main", work]);
  git(work, ["config", "user.name", "actions-bot"]);
  git(work, ["config", "user.email", "actions@github.com"]);
  git(work, ["config", "commit.gpgsign", "false"]);
  git(work, ["config", "protocol.file.allow", "always"]);
  git(work, ["remote", "add", "origin", origin]);

  return { parent, origin, work };
}

function commitAndPush(work: string, message: string) {
  git(work, ["add", "data"]);
  git(work, ["commit", "-m", message]);
  git(work, ["push", "-u", "origin", "main"]);
}

function cloneFresh(origin: string, parent: string) {
  const fresh = path.join(parent, "fresh");
  git(parent, ["clone", origin, fresh]);
  return fresh;
}

function classifyHead(repo: string) {
  const result = spawnSync(process.execPath, [ROUTE, "classify-head"], {
    cwd: repo,
    encoding: "utf8",
    env: gitEnv(),
  });
  expect(result.status, result.stderr).toBe(0);

  return Object.fromEntries(
    result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function hook(file: string, script: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, script);
  chmodSync(file, 0o755);
}

afterEach(() => {
  CONFIG.ai = ai;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("batch recovery checkpoint", () => {
  const alphaJd = jd("Alpha HQ");

  async function rerun(repo: string) {
    paths.root = repo;
    provider.generate.mockClear();
    provider.submitBatch.mockClear();
    provider.getBatch.mockClear();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("recovery rerun must not use the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Posting.prototype, "getRawJD")
      .mockResolvedValue({ jd: "raw jd", error: JD_FETCH_OK })
      .mockClear();
    CONFIG.ai = { enabled: true, provider: "google", model: "test-model" };
    process.env.AI_API_KEY = "test-fake-ai-key";

    const first = await processBatchQueue(0);
    const jobs = readFileSync(path.join(repo, "data/jobs.ndjson"), "utf8");
    const opportunities = readFileSync(path.join(repo, "data/opportunities.ndjson"), "utf8");
    const again = await processBatchQueue(0);

    expect(again).toMatchObject({ notified: 0, totalCost: 0 });
    expect(readFileSync(path.join(repo, "data/jobs.ndjson"), "utf8")).toBe(jobs);
    expect(readFileSync(path.join(repo, "data/opportunities.ndjson"), "utf8")).toBe(opportunities);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    return first;
  }

  it("replays A from the restored result after B fails, including when the first push is rejected", async () => {
    const repo = initRepo();
    const saved = pending(alpha, alphaJd, 0.01);
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": ndjson([saved]),
      "data/batch/failures.ndjson": ndjson([
        { key: saved.key, job: saved.job, status: "retrying", attempts: [], cost: 0.01 },
      ]),
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
    });
    commitAndPush(repo.work, "chore(batch): checkpoint inflight submissions [skip ci]");

    writeBatch(repo.work, {
      "data/batch/queue.ndjson": "",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
      "data/jobs.ndjson": ndjson([stored(alpha, 1, alphaJd)]),
      "data/opportunities.ndjson": ndjson([
        { ...stored(alpha, 1, alphaJd), expired: false, postedAt: "2026-11-07T09:05:00.000Z" },
      ]),
    });

    const savedState = recover(repo.work);
    expect(savedState.status, savedState.stderr).toBe(0);
    expect(savedState.stdout).toContain("committed=true");
    expect(git(repo.work, ["diff", "--name-only", "HEAD~1", "HEAD"])).not.toMatch(
      /jobs|opportunities/
    );
    expect(readNdjson(path.join(repo.work, "data/batch/results.ndjson"))).toEqual([saved]);
    expect(readNdjson(path.join(repo.work, "data/jobs.ndjson"))).toEqual([]);
    expect(classifyHead(repo.work)).toMatchObject({ notify: "false", run: "false" });

    hook(path.join(repo.origin, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n");
    const rejected = spawnSync(
      "git",
      ["-c", "protocol.file.allow=always", "push", "origin", "HEAD:main"],
      {
        cwd: repo.work,
        encoding: "utf8",
        env: gitEnv(),
      }
    );
    expect(rejected.status).not.toBe(0);
    expect(readNdjson(path.join(repo.work, "data/batch/results.ndjson"))).toEqual([saved]);
    expect(git(repo.work, ["status", "--porcelain"])).toBe("");
    rmSync(path.join(repo.origin, "hooks/pre-receive"));

    git(repo.work, ["push", "origin", "HEAD:main"]);
    const fresh = cloneFresh(repo.origin, repo.parent);
    expect(readNdjson(path.join(fresh, "data/jobs.ndjson"))).toEqual([]);
    expect(readNdjson(path.join(fresh, "data/batch/results.ndjson"))).toEqual([saved]);

    const first = await rerun(fresh);

    expect(first).toMatchObject({ notified: 1, totalCost: 0.01 });
    expect(readNdjson<Job>(path.join(fresh, "data/jobs.ndjson"))).toEqual([
      stored(alpha, 1, alphaJd),
    ]);
    const opportunities = readNdjson<Opportunity>(path.join(fresh, "data/opportunities.ndjson"));
    expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
      { ...stored(alpha, 1, alphaJd), expired: false },
    ]);
    expect(readNdjson(path.join(fresh, "data/batch/results.ndjson"))).toEqual([]);
  });

  it("keeps a new qualification id when jobs or opportunities were not stored", async () => {
    const betaScreen = jd("Beta HQ", null);
    const betaStored = jd("Beta HQ", ["TypeScript"]);
    const screen = {
      name: "batches/done",
      submittedAt: "2026-09-01T00:00:00.000Z",
      phase: "screen",
      jobs: [alpha, beta],
    };
    const qualifications = {
      name: "batches/quals",
      submittedAt: "2026-09-01T00:05:00.000Z",
      phase: "qualifications",
      jobs: [{ ...beta, jd: betaScreen }],
      screenCosts: { [getJobKey(beta.link)]: 0.002 },
    };
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 1_000,
      results: [
        { key: getJobKey(alpha.link), result: JSON.stringify(alphaJd), cost: 0.001 },
        { key: getJobKey(beta.link), result: JSON.stringify(betaScreen), cost: 0.002 },
      ],
    });
    provider.batches.set("batches/quals", {
      state: "succeeded",
      durationMs: 1_000,
      results: [
        {
          key: getJobKey(beta.link),
          result: JSON.stringify({ qualifications: ["TypeScript"] }),
          cost: 0.003,
        },
      ],
    });

    async function checkoutAfter(jobsBody: string) {
      const repo = initRepo();
      writeBatch(repo.work, {
        "data/batch/queue.ndjson": "",
        "data/batch/inflight.json": `${JSON.stringify([screen], null, 2)}\n`,
        "data/batch/results.ndjson": "",
        "data/batch/failures.ndjson": "",
        "data/jobs.ndjson": "",
        "data/opportunities.ndjson": "",
      });
      commitAndPush(repo.work, "chore(batch): checkpoint inflight submissions [skip ci]");
      writeBatch(repo.work, {
        "data/batch/inflight.json": `${JSON.stringify([screen, qualifications], null, 2)}\n`,
        "data/jobs.ndjson": jobsBody,
      });

      const savedState = recover(repo.work);
      expect(savedState.status, savedState.stderr).toBe(0);
      expect(savedState.stdout).toContain("committed=true");
      expect(
        JSON.parse(readFileSync(path.join(repo.work, "data/batch/inflight.json"), "utf8")).map(
          (batch: { name: string }) => batch.name
        )
      ).toEqual(["batches/done", "batches/quals"]);
      expect(git(repo.work, ["diff", "--name-only", "HEAD~1", "HEAD"])).not.toMatch(
        /jobs|opportunities/
      );
      expect(readNdjson(path.join(repo.work, "data/jobs.ndjson"))).toEqual([]);

      git(repo.work, ["push", "origin", "HEAD:main"]);
      return cloneFresh(repo.origin, repo.parent);
    }

    const jobsFailed = await checkoutAfter("");
    const afterJobsFailure = await rerun(jobsFailed);
    expect(afterJobsFailure.submitted).toBe(0);
    expect(provider.getBatch.mock.calls.map(([name]) => name).sort()).toEqual([
      "batches/done",
      "batches/quals",
    ]);
    expect(
      readNdjson<Job>(path.join(jobsFailed, "data/jobs.ndjson")).map((job) => [
        job.id,
        job.link,
        job.jd,
      ])
    ).toEqual([
      [1, alpha.link, alphaJd],
      [2, beta.link, betaStored],
    ]);

    provider.getBatch.mockClear();
    const opportunitiesFailed = await checkoutAfter(
      ndjson([stored(alpha, 1, alphaJd), stored(beta, 2, betaStored)])
    );
    const afterOpportunityFailure = await rerun(opportunitiesFailed);
    expect(afterOpportunityFailure.submitted).toBe(0);
    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(
      readNdjson<Job>(path.join(opportunitiesFailed, "data/jobs.ndjson")).map((job) => job.id)
    ).toEqual([1, 2]);
    expect(
      readNdjson<Opportunity>(path.join(opportunitiesFailed, "data/opportunities.ndjson")).map(
        (row) => row.id
      )
    ).toEqual([1, 2]);
  });

  it("restores the same ids when the result is still on disk or only the job line remains", async () => {
    const saved = pending(alpha, alphaJd, 0.01);

    async function replay(workFiles: Record<string, string>) {
      const repo = initRepo();
      writeBatch(repo.work, {
        "data/batch/queue.ndjson": ndjson([alpha]),
        "data/batch/inflight.json": "[]\n",
        "data/batch/results.ndjson": ndjson([saved]),
        "data/batch/failures.ndjson": "",
        "data/jobs.ndjson": "",
        "data/opportunities.ndjson": "",
      });
      commitAndPush(repo.work, "base");
      writeBatch(repo.work, workFiles);

      const savedState = recover(repo.work);
      expect(savedState.status, savedState.stderr).toBe(0);
      git(repo.work, ["push", "origin", "HEAD:main"]);
      const fresh = cloneFresh(repo.origin, repo.parent);
      await rerun(fresh);

      expect(readNdjson<Job>(path.join(fresh, "data/jobs.ndjson"))).toEqual([
        stored(alpha, 1, alphaJd),
      ]);
      expect(
        readNdjson<Opportunity>(path.join(fresh, "data/opportunities.ndjson")).map((row) => row.id)
      ).toEqual([1]);
      expect(readNdjson(path.join(fresh, "data/batch/results.ndjson"))).toEqual([]);
    }

    await replay({
      "data/batch/queue.ndjson": "",
      "data/batch/results.ndjson": ndjson([saved]),
      "data/jobs.ndjson": ndjson([stored(alpha, 1, alphaJd)]),
      "data/opportunities.ndjson": ndjson([
        { ...stored(alpha, 1, alphaJd), expired: false, postedAt: "2026-11-07T09:05:00.000Z" },
      ]),
    });
    await replay({
      "data/batch/queue.ndjson": "",
      "data/batch/results.ndjson": "",
      "data/jobs.ndjson": ndjson([stored(alpha, 1, alphaJd)]),
      "data/opportunities.ndjson": "",
    });

    const repo = initRepo();
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": "",
      "data/batch/results.ndjson": "",
      "data/jobs.ndjson": ndjson([stored(alpha, 1, alphaJd)]),
    });
    expect(recover(repo.work).status).toBe(0);
    git(repo.work, ["push", "origin", "HEAD:main"]);
    const fresh = cloneFresh(repo.origin, repo.parent);
    expect(readNdjson(path.join(fresh, "data/batch/results.ndjson"))).toEqual([
      expect.objectContaining({
        attemptId: `recovered:${getJobKey(alpha.link)}`,
        jd: alphaJd,
        cost: 0,
      }),
    ]);
    await rerun(fresh);
    expect(readNdjson<Job>(path.join(fresh, "data/jobs.ndjson"))).toEqual([
      stored(alpha, 1, alphaJd),
    ]);
  });

  it("leaves the replay record and the uncommitted job in place when the recovery commit is rejected", async () => {
    const repo = initRepo();
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    const base = git(repo.work, ["rev-parse", "HEAD"]);
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": "",
      "data/batch/results.ndjson": "",
      "data/jobs.ndjson": ndjson([stored(alpha, 1, alphaJd)]),
    });
    hook(
      path.join(repo.work, ".git/hooks/pre-commit"),
      "#!/bin/sh\necho injected recovery commit failure >&2\nexit 1\n"
    );

    const savedState = recover(repo.work);

    expect(savedState.status).not.toBe(0);
    expect(savedState.stderr).toContain("injected recovery commit failure");
    expect(git(repo.work, ["rev-parse", "HEAD"])).toBe(base);
    expect(readNdjson<Job>(path.join(repo.work, "data/jobs.ndjson"))).toEqual([
      stored(alpha, 1, alphaJd),
    ]);
    expect(readNdjson(path.join(repo.work, "data/batch/results.ndjson"))).toEqual([
      expect.objectContaining({
        key: getJobKey(alpha.link),
        jd: alphaJd,
        attemptId: `recovered:${getJobKey(alpha.link)}`,
        cost: 0,
      }),
    ]);
  });

  it("does not publish or rerun a collect commit that already stored the jobs", async () => {
    const repo = initRepo();
    const body = ndjson([stored(alpha, 1, alphaJd)]);
    const opportunities = ndjson([
      { ...stored(alpha, 1, alphaJd), expired: false, postedAt: "2026-11-07T09:05:00.000Z" },
    ]);
    writeBatch(repo.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
      "data/batch/queue.ndjson": "",
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    writeBatch(repo.work, {
      "data/jobs.ndjson": body,
      "data/opportunities.ndjson": opportunities,
    });
    commitAndPush(repo.work, "chore(batch): collect batch analysis");
    const head = git(repo.work, ["rev-parse", "HEAD"]);

    expect(classifyHead(repo.work)).toMatchObject({ notify: "true", run: "true" });
    expect(
      routePush("chore(batch): collect batch analysis", [
        "data/jobs.ndjson",
        "data/opportunities.ndjson",
      ])
    ).toEqual({
      run: false,
      board: false,
      notify: false,
    });

    const savedState = recover(repo.work);

    expect(savedState.status, savedState.stderr).toBe(0);
    expect(savedState.stdout).toContain("committed=false");
    expect(git(repo.work, ["rev-parse", "HEAD"])).toBe(head);
    expect(readFileSync(path.join(repo.work, "data/jobs.ndjson"), "utf8")).toBe(body);
    expect(readFileSync(path.join(repo.work, "data/opportunities.ndjson"), "utf8")).toBe(
      opportunities
    );

    const rerunResult = await rerun(repo.work);
    expect(rerunResult).toMatchObject({ notified: 0, totalCost: 0, submitted: 0 });
    expect(readFileSync(path.join(repo.work, "data/jobs.ndjson"), "utf8")).toBe(body);
  });

  it("reads an archive larger than 1 MiB and keeps the checkpoint to this round", async () => {
    const repo = initRepo();
    const sentinel = listing("Sentinel", "900001");
    const gamma = listing("Gamma", "900002");
    const sentinelJd = jd("Sentinel HQ");
    const gammaJd = jd("Gamma HQ");
    const historical = [
      ...Array.from({ length: 200 }, (_, index) => ({
        id: 10000 + index,
        ...listing("Legacy", String(10000 + index)),
        jd: { location: "Other", season: "Senior Level" },
      })),
      ...Array.from({ length: 50 }, (_, index) =>
        stored(listing("History", String(20000 + index)), 20000 + index, jd("History HQ"))
      ),
      stored(sentinel, 900001, sentinelJd),
    ];
    const padding = Array.from({ length: 4500 }, (_, index) =>
      JSON.stringify({
        id: 30000 + index,
        company: "Archive",
        role: "Role",
        link: `https://job-boards.greenhouse.io/archive/jobs/${30000 + index}`,
        location: "Austin, TX",
        expired: false,
        postedAt: "2020-01-01T00:00:00.000Z",
        note: "x".repeat(180),
      })
    );
    const sentinelOpportunity = JSON.stringify({
      ...stored(sentinel, 900001, sentinelJd),
      expired: false,
      postedAt: "2020-01-01T00:00:00.000Z",
    });
    const archive = `${padding.join("\n")}\n${sentinelOpportunity}\n`;
    expect(Buffer.byteLength(archive)).toBeGreaterThan(1024 * 1024);

    writeBatch(repo.work, {
      "data/jobs.ndjson": ndjson(historical),
      "data/opportunities.ndjson": "",
      "data/archive/opportunities-001.ndjson": archive,
      "data/batch/queue.ndjson": "",
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    writeBatch(repo.work, {
      "data/jobs.ndjson": ndjson([...historical, stored(gamma, 900002, gammaJd)]),
      "data/batch/results.ndjson": ndjson([
        pending(sentinel, sentinelJd, 0.02),
        pending(alpha, alphaJd, 0.01),
      ]),
    });

    const savedState = recover(repo.work);

    expect(savedState.status, savedState.stderr).toBe(0);
    expect(savedState.stdout).toContain("committed=true");
    const checkpoint = readNdjson<{ key: string; attemptId: string; cost: number; jd: JD }>(
      path.join(repo.work, "data/batch/results.ndjson")
    );
    expect(checkpoint.map((result) => result.key).sort()).toEqual(
      [getJobKey(alpha.link), getJobKey(gamma.link)].sort()
    );
    expect(checkpoint).toContainEqual(pending(alpha, alphaJd, 0.01));
    expect(checkpoint).toContainEqual(
      expect.objectContaining({
        key: getJobKey(gamma.link),
        attemptId: `recovered:${getJobKey(gamma.link)}`,
        cost: 0,
        jd: gammaJd,
      })
    );
    expect(readNdjson(path.join(repo.work, "data/batch/queue.ndjson"))).toEqual([]);
    expect(
      JSON.parse(readFileSync(path.join(repo.work, "data/batch/inflight.json"), "utf8"))
    ).toEqual([]);
    expect(git(repo.work, ["diff", "--name-only", "HEAD~1", "HEAD"])).not.toMatch(
      /jobs|opportunities/
    );

    git(repo.work, ["push", "origin", "HEAD:main"]);
    const fresh = cloneFresh(repo.origin, repo.parent);
    const archived = readFileSync(
      path.join(fresh, "data/archive/opportunities-001.ndjson"),
      "utf8"
    );
    expect(Buffer.byteLength(archived)).toBeGreaterThan(1024 * 1024);
    expect(JSON.parse(archived.trim().split("\n").at(-1) ?? "")).toMatchObject({
      link: sentinel.link,
      jd: sentinelJd,
    });
    await rerun(fresh);

    const jobs = readNdjson<Job>(path.join(fresh, "data/jobs.ndjson"));
    expect(jobs.filter((job) => job.link.includes("/legacy/"))).toHaveLength(200);
    expect(jobs.filter((job) => job.link.includes("/history/"))).toHaveLength(50);
    expect(jobs.filter((job) => job.link === sentinel.link)).toHaveLength(1);
    expect(jobs.filter((job) => job.link === alpha.link)).toHaveLength(1);
    expect(jobs.filter((job) => job.link === gamma.link)).toHaveLength(1);
    expect(readNdjson(path.join(fresh, "data/batch/results.ndjson"))).toEqual([]);
    expect(
      readNdjson<Opportunity>(path.join(fresh, "data/opportunities.ndjson")).map((row) => row.link)
    ).toEqual([alpha.link, gamma.link]);
  });

  it("stops recovery when an archive blob cannot be read", () => {
    const repo = initRepo();
    const archive = `${JSON.stringify({
      id: 1,
      company: "Archive",
      role: "Role",
      link: "https://job-boards.greenhouse.io/archive/jobs/1",
      location: "Austin, TX",
      expired: false,
      postedAt: "2020-01-01T00:00:00.000Z",
    })}\n`;
    writeBatch(repo.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
      "data/archive/opportunities-001.ndjson": archive,
      "data/batch/queue.ndjson": "",
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    const head = git(repo.work, ["rev-parse", "HEAD"]);
    const hash = git(repo.work, ["rev-parse", "HEAD:data/archive/opportunities-001.ndjson"]);
    const objectPath = path.join(repo.work, ".git/objects", hash.slice(0, 2), hash.slice(2));
    expect(existsSync(objectPath)).toBe(true);
    rmSync(objectPath);
    const marker = `${JSON.stringify({ kept: true })}\n`;
    writeBatch(repo.work, { "data/batch/results.ndjson": marker });

    const savedState = recover(repo.work);

    expect(savedState.status).not.toBe(0);
    expect(savedState.stderr).toMatch(/fatal:|bad object|unable to read/);
    expect(savedState.stdout).not.toContain("committed=");
    expect(git(repo.work, ["rev-parse", "HEAD"])).toBe(head);
    expect(readFileSync(path.join(repo.work, "data/batch/results.ndjson"), "utf8")).toBe(marker);
    expect(
      readFileSync(path.join(repo.work, "data/archive/opportunities-001.ndjson"), "utf8")
    ).toBe(archive);
  });

  it("reports an invalid JD for this round and leaves the recoverable files in place", () => {
    const repo = initRepo();
    writeBatch(repo.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
      "data/batch/queue.ndjson": "",
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    const head = git(repo.work, ["rev-parse", "HEAD"]);
    const legacy = {
      id: 1,
      ...alpha,
      jd: { location: "Other", season: "Senior Level" },
    };
    writeBatch(repo.work, { "data/jobs.ndjson": ndjson([legacy]) });

    const savedState = recover(repo.work);

    expect(savedState.status).not.toBe(0);
    expect(savedState.stderr).toContain(getJobKey(alpha.link));
    expect(savedState.stderr).toContain("failed validation");
    expect(savedState.stderr).toContain("season");
    expect(git(repo.work, ["rev-parse", "HEAD"])).toBe(head);
    expect(readNdjson(path.join(repo.work, "data/jobs.ndjson"))).toEqual([legacy]);
    expect(readFileSync(path.join(repo.work, "data/batch/results.ndjson"), "utf8")).toBe("");
  });

  it("normalizes a legal past season when rebuilding the only copy of a JD", () => {
    const repo = initRepo();
    const past = { ...alphaJd, season: "2024 Summer" as JD["season"] };
    writeBatch(repo.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
      "data/batch/queue.ndjson": "",
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    writeBatch(repo.work, { "data/jobs.ndjson": ndjson([stored(alpha, 1, past)]) });

    const savedState = recover(repo.work);

    expect(savedState.status, savedState.stderr).toBe(0);
    expect(readNdjson(path.join(repo.work, "data/batch/results.ndjson"))).toEqual([
      expect.objectContaining({
        key: getJobKey(alpha.link),
        attemptId: `recovered:${getJobKey(alpha.link)}`,
        cost: 0,
        jd: past,
      }),
    ]);
  });

  it("replays a valid result when HEAD has the key but not a matching JD", async () => {
    const repo = initRepo();
    const legacy = { location: "Other", season: "Senior Level" };
    const historical = stored(listing("History", "1"), 2, jd("History HQ"));
    const saved = pending(alpha, alphaJd, 0.01);
    writeBatch(repo.work, {
      "data/jobs.ndjson": ndjson([historical, { id: 1, ...alpha, jd: legacy }]),
      "data/opportunities.ndjson": ndjson([
        {
          id: 1,
          company: alpha.company,
          role: alpha.role,
          link: alpha.link,
          location: alpha.location,
          expired: false,
          postedAt: "2020-01-01T00:00:00.000Z",
        },
      ]),
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/results.ndjson": ndjson([saved]),
    });

    const savedState = recover(repo.work);

    expect(savedState.status, savedState.stderr).toBe(0);
    expect(readNdjson(path.join(repo.work, "data/batch/results.ndjson"))).toEqual([saved]);
    expect(readNdjson(path.join(repo.work, "data/batch/queue.ndjson"))).toEqual([alpha]);
    expect(
      JSON.parse(readFileSync(path.join(repo.work, "data/batch/inflight.json"), "utf8"))
    ).toEqual([]);
    git(repo.work, ["push", "origin", "HEAD:main"]);
    const fresh = cloneFresh(repo.origin, repo.parent);
    await rerun(fresh);

    const jobs = readNdjson<Job>(path.join(fresh, "data/jobs.ndjson"));
    expect(jobs).toHaveLength(2);
    expect(jobs.find((job) => job.link === alpha.link)).toMatchObject({ id: 1, jd: legacy });
    expect(jobs.find((job) => job.link === historical.link)?.jd).toEqual(historical.jd);
    const opportunities = readNdjson<Opportunity>(path.join(fresh, "data/opportunities.ndjson"));
    expect(opportunities.map((row) => row.link)).toEqual([alpha.link]);
    expect(opportunities[0]?.jd).toEqual(alphaJd);
    expect(readNdjson(path.join(fresh, "data/batch/results.ndjson"))).toEqual([]);
    expect(readNdjson(path.join(fresh, "data/batch/queue.ndjson"))).toEqual([]);
  });

  it("replays a JD stored only on an opportunity when the job is outside the allowed countries", async () => {
    const repo = initRepo();
    const india = { ...listing("Nimbus", "81050"), location: "Bengaluru, India" };
    const indiaJd: JD = { ...jd("Bengaluru, India"), country: "India" };
    const historical = [1, 2, 3].map((index) => ({
      id: 82000 + index,
      company: "History",
      role: "Software Engineer Intern",
      link: `https://job-boards.greenhouse.io/history/jobs/${82000 + index}`,
      location: "Austin, TX",
      jd: jd("History HQ"),
      expired: false,
      postedAt: "2020-01-01T00:00:00.000Z",
    }));
    const indiaOpportunity = {
      id: 81050,
      company: india.company,
      role: india.role,
      link: india.link,
      location: india.location,
      expired: false,
      postedAt: "2026-11-07T09:00:00.000Z",
    };

    writeBatch(repo.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": ndjson([...historical, indiaOpportunity]),
      "data/batch/queue.ndjson": ndjson([india]),
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": "",
      "data/batch/results.ndjson": "",
      "data/opportunities.ndjson": ndjson([...historical, { ...indiaOpportunity, jd: indiaJd }]),
    });

    const savedState = recover(repo.work);

    expect(savedState.status, savedState.stderr).toBe(0);
    expect(savedState.stdout).toContain("committed=true");
    expect(readNdjson(path.join(repo.work, "data/batch/results.ndjson"))).toEqual([
      expect.objectContaining({
        key: getJobKey(india.link),
        job: {
          company: india.company,
          role: india.role,
          link: india.link,
          location: india.location,
        },
        jd: indiaJd,
        attemptId: `recovered:${getJobKey(india.link)}`,
        cost: 0,
      }),
    ]);
    expect(readNdjson(path.join(repo.work, "data/batch/queue.ndjson"))).toEqual([]);
    expect(
      JSON.parse(readFileSync(path.join(repo.work, "data/batch/inflight.json"), "utf8"))
    ).toEqual([]);
    expect(git(repo.work, ["diff", "--name-only", "HEAD~1", "HEAD"])).not.toMatch(
      /jobs|opportunities/
    );

    git(repo.work, ["push", "origin", "HEAD:main"]);
    const fresh = cloneFresh(repo.origin, repo.parent);
    const first = await rerun(fresh);

    expect(first).toMatchObject({ notified: 0, totalCost: 0 });
    expect(readNdjson(path.join(fresh, "data/jobs.ndjson"))).toEqual([]);
    const opportunities = readNdjson<Opportunity>(path.join(fresh, "data/opportunities.ndjson"));
    expect(opportunities.find((row) => row.link === india.link)?.jd).toEqual(indiaJd);
    expect(opportunities.filter((row) => row.link.includes("/history/"))).toHaveLength(
      historical.length
    );

    for (const old of historical) {
      expect(opportunities.find((row) => row.link === old.link)?.jd).toEqual(old.jd);
    }

    expect(readNdjson(path.join(fresh, "data/batch/results.ndjson"))).toEqual([]);
    expect(readNdjson(path.join(fresh, "data/batch/queue.ndjson"))).toEqual([]);
    expect(Posting.prototype.getRawJD).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("keeps a fetch failure's attempts, schedule, and queue through recovery", () => {
    const repo = initRepo();
    const attempt = {
      id: "fetch:once",
      at: "2026-11-07T12:00:00.000Z",
      failure: { stage: "fetch", error: { code: 503, desc: "unavailable" } },
      cost: 0,
      round: 0,
    };
    const first = {
      key: getJobKey(alpha.link),
      job: alpha,
      status: "retrying",
      failure: attempt.failure,
      attempts: [attempt],
      cost: 0,
      firstFailedAt: attempt.at,
      lastFailedAt: attempt.at,
      manualRetries: 0,
      nextAttemptAt: "2026-11-07T12:00:30.000Z",
    };
    writeBatch(repo.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": "",
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": ndjson([first]),
    });
    commitAndPush(repo.work, "base");
    const secondAttempt = { ...attempt, id: "fetch:twice", at: "2026-11-07T12:01:00.000Z" };
    writeBatch(repo.work, {
      "data/batch/failures.ndjson": ndjson([
        {
          ...first,
          attempts: [attempt, secondAttempt],
          lastFailedAt: secondAttempt.at,
          nextAttemptAt: "2026-11-07T12:02:00.000Z",
        },
      ]),
    });

    expect(recover(repo.work).status).toBe(0);
    const saved = readNdjson<{
      attempts: { id: string }[];
      nextAttemptAt: string;
    }>(path.join(repo.work, "data/batch/failures.ndjson"));
    expect(saved[0]?.attempts.map((item) => item.id)).toEqual(["fetch:once", "fetch:twice"]);
    expect(saved[0]?.nextAttemptAt).toBe("2026-11-07T12:02:00.000Z");
    expect(readNdjson(path.join(repo.work, "data/batch/queue.ndjson"))).toEqual([alpha]);

    const settled = initRepo();
    const failed = {
      ...first,
      status: "failed",
      attempts: [attempt, secondAttempt, { ...attempt, id: "fetch:third" }],
    };
    writeBatch(settled.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": ndjson([
        {
          company: alpha.company,
          role: alpha.role,
          link: alpha.link,
          location: alpha.location,
          postedAt: "2026-11-07T12:00:00.000Z",
          expired: false,
        },
      ]),
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": ndjson([failed]),
    });
    commitAndPush(settled.work, "base");
    writeBatch(settled.work, { "data/batch/queue.ndjson": "" });

    expect(recover(settled.work).status).toBe(0);
    expect(readNdjson(path.join(settled.work, "data/batch/queue.ndjson"))).toEqual([alpha]);
    expect(
      readNdjson<{ attempts: unknown[] }>(path.join(settled.work, "data/batch/failures.ndjson"))[0]
        ?.attempts
    ).toHaveLength(3);
  });

  it("rewrites a new exhausted stop over an older gone stop, and leaves a matching stop alone", async () => {
    const oldAt = "2026-11-07T11:00:00.000Z";
    const lastAt = "2026-11-07T12:03:00.000Z";
    const unavailable = JD_FETCH_ERROR.http(HttpStatusCode.SERVICE_UNAVAILABLE, "unavailable");
    const removed = JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found");
    const oldStop = { reason: "gone" as const, code: 404, at: oldAt };
    const newStop = { reason: "exhausted" as const, code: 503, at: lastAt };
    const attempts = [
      {
        id: "fetch:404",
        at: oldAt,
        failure: { stage: "fetch", error: removed },
        cost: 0,
        round: 0,
      },
      {
        id: "fetch:503-a",
        at: "2026-11-07T12:01:00.000Z",
        failure: { stage: "fetch", error: unavailable },
        cost: 0,
        round: 1,
      },
      {
        id: "fetch:503-b",
        at: "2026-11-07T12:02:00.000Z",
        failure: { stage: "fetch", error: unavailable },
        cost: 0,
        round: 1,
      },
      {
        id: "fetch:503-c",
        at: lastAt,
        failure: { stage: "fetch", error: unavailable },
        cost: 0,
        round: 1,
      },
    ];
    const failed = {
      key: getJobKey(alpha.link),
      job: alpha,
      status: "failed",
      failure: attempts[3]?.failure,
      attempts,
      cost: 0,
      firstFailedAt: oldAt,
      lastFailedAt: lastAt,
      manualRetries: 1,
    };
    const opportunity = {
      company: alpha.company,
      role: alpha.role,
      link: alpha.link,
      location: alpha.location,
      postedAt: oldAt,
      expired: true,
      stop: oldStop,
    };

    expect(opportunityStopSaved(opportunity, unavailable, lastAt)).toBe(false);
    expect(opportunityStopSaved({ ...opportunity, stop: newStop }, unavailable, lastAt)).toBe(true);
    expect(opportunityStopSaved({ ...opportunity, expired: false }, removed, oldAt)).toBe(false);
    expect(opportunityStopSaved(opportunity, removed, oldAt)).toBe(true);

    const repo = initRepo();
    writeBatch(repo.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": ndjson([opportunity]),
      "data/batch/queue.ndjson": "",
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": "",
    });
    commitAndPush(repo.work, "base");
    writeBatch(repo.work, {
      "data/batch/queue.ndjson": ndjson([alpha]),
      "data/batch/failures.ndjson": ndjson([failed]),
    });

    const savedState = recover(repo.work);
    expect(savedState.status, savedState.stderr).toBe(0);
    expect(readNdjson(path.join(repo.work, "data/batch/queue.ndjson"))).toEqual([alpha]);
    expect(
      readNdjson<{ attempts: { id: string }[] }>(
        path.join(repo.work, "data/batch/failures.ndjson")
      )[0]?.attempts.map((item) => item.id)
    ).toEqual(attempts.map((item) => item.id));
    git(repo.work, ["push", "origin", "HEAD:main"]);

    const fresh = cloneFresh(repo.origin, repo.parent);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T00:00:00.000Z"));
    paths.root = fresh;
    provider.generate.mockClear();
    provider.submitBatch.mockClear();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("recovery rerun must not use the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    const rawJD = vi.spyOn(Posting.prototype, "getRawJD").mockClear();
    CONFIG.ai = { enabled: true, provider: "google", model: "test-model" };
    process.env.AI_API_KEY = "test-fake-ai-key";

    await processBatchQueue(120_000, { wait: false });
    await processBatchQueue(120_000, { wait: false });

    const rewritten = readNdjson<Opportunity>(path.join(fresh, "data/opportunities.ndjson"));
    expect(rewritten).toEqual([{ ...opportunity, stop: newStop }]);
    expect(readNdjson(path.join(fresh, "data/batch/queue.ndjson"))).toEqual([]);
    expect(
      readNdjson<{ attempts: { id: string }[] }>(
        path.join(fresh, "data/batch/failures.ndjson")
      )[0]?.attempts.map((item) => item.id)
    ).toEqual(attempts.map((item) => item.id));
    expect(rawJD).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const matched = initRepo();
    const savedOpportunity = { ...opportunity, stop: newStop };
    writeBatch(matched.work, {
      "data/jobs.ndjson": "",
      "data/opportunities.ndjson": ndjson([savedOpportunity]),
      "data/batch/queue.ndjson": "",
      "data/batch/inflight.json": "[]\n",
      "data/batch/results.ndjson": "",
      "data/batch/failures.ndjson": ndjson([failed]),
    });
    commitAndPush(matched.work, "base");
    writeBatch(matched.work, { "data/batch/queue.ndjson": ndjson([alpha]) });

    expect(recover(matched.work).status).toBe(0);
    expect(readNdjson(path.join(matched.work, "data/batch/queue.ndjson"))).toEqual([]);
    git(matched.work, ["push", "origin", "HEAD:main"]);
    const again = cloneFresh(matched.origin, matched.parent);
    const before = readFileSync(path.join(again, "data/opportunities.ndjson"), "utf8");
    paths.root = again;
    rawJD.mockClear();
    await processBatchQueue(120_000, { wait: false });

    expect(readFileSync(path.join(again, "data/opportunities.ndjson"), "utf8")).toBe(before);
    expect(readNdjson(path.join(again, "data/batch/queue.ndjson"))).toEqual([]);
    expect(rawJD).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("plans a production-sized snapshot without rebuilding a key set per job", () => {
    const jobCount = 6641;
    const opportunityCount = 47144;
    const jobs = Array.from({ length: jobCount }, (_, index) => ({
      company: "Old",
      role: "Role",
      link: `https://job-boards.greenhouse.io/old/jobs/${index + 1}`,
      location: "Austin, TX",
      jd:
        index < 100
          ? jd("Old HQ")
          : {
              location: "Other",
              season: "Senior Level",
            },
    }));
    const opportunities = Array.from({ length: opportunityCount }, (_, index) => ({
      company: "Seen",
      role: "Role",
      link: `https://job-boards.greenhouse.io/seen/jobs/${index + 1}`,
      location: "Austin, TX",
      expired: false,
    }));
    const saved = pending(alpha, alphaJd, 0.01);
    const snapshot = {
      jobs,
      opportunities,
      queue: [] as Job[],
      inflight: [],
      results: [],
      failures: [],
    };
    const started = performance.now();
    const plan = planBatchRecovery(snapshot, {
      ...snapshot,
      queue: [alpha],
      results: [saved],
    });
    const elapsed = performance.now() - started;

    console.log(
      `planBatchRecovery ${jobCount} jobs, ${opportunityCount} opportunities: ${elapsed.toFixed(1)} ms`
    );
    expect(elapsed).toBeLessThan(2000);
    expect(plan.results).toEqual([saved]);
    expect(plan.queue).toEqual([alpha]);
    expect(plan.inflight).toEqual([]);
    expect(plan.failures).toEqual([]);
  });
});
