import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Company, Opportunity } from "@/types";

const processJobs = vi.hoisted(() => vi.fn());
const createSyncContext = vi.hoisted(() => vi.fn());
const knownEmployerName = vi.hoisted(() => vi.fn());
const analyzeLink = vi.hoisted(() => vi.fn());
const prompt = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  urls: new Set<string>(),
  companies: [] as Company[],
  opportunities: [] as Opportunity[],
  savedUrls: undefined as Set<string> | undefined,
  savedCompanies: undefined as Company[] | undefined,
  savedOpportunities: undefined as Opportunity[] | undefined,
}));

vi.mock("@scripts/ingest", () => ({
  createSyncContext,
  processJobs,
}));

vi.mock("@/modules/employer/remap", () => ({
  knownEmployerName,
}));

vi.mock("@/modules/employer/build", () => ({
  companyKey: (company: { ats: string; identifier: string }) => `${company.ats}:${company.identifier}`,
}));

vi.mock("@/modules/posting", () => ({
  analyzeLink,
}));

vi.mock("inquirer", () => ({
  default: { prompt },
}));

vi.mock("@/store", () => ({
  companies: {
    load: vi.fn(async () => store.companies),
    save: vi.fn(async (companies: Company[]) => {
      store.savedCompanies = companies;
    }),
  },
  urls: {
    load: vi.fn(async () => store.urls),
    save: vi.fn(async (urls: Set<string>) => {
      store.savedUrls = urls;
    }),
  },
  opportunities: {
    load: vi.fn(async () => store.opportunities),
    replace: vi.fn(async (opportunities: Opportunity[]) => {
      store.savedOpportunities = opportunities;
    }),
  },
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    level: "info",
  },
}));

import { addJob } from "../add";
import { analyzeJobs } from "../analyze";
import { deleteUrls } from "../delete";

import { logger } from "@/utils/logger";

const alpha = "https://example.com/jobs/1";
const beta = "https://example.com/jobs/2";
const similar = "https://example.com/jobs/1/";

function exitOnDemand() {
  return vi.spyOn(process, "exit").mockImplementation(((status?: number) => {
    throw new Error(`exit:${status}`);
  }) as typeof process.exit);
}

function setTty(value: boolean | undefined) {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

describe("job add, analyze, and delete", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "jobradar-jobctl-"));
    processJobs.mockReset().mockResolvedValue({
      count: 1,
      skipped: 0,
      failed: 0,
      batched: 0,
      jobs: [],
      totalCost: 0,
      forceStopped: false,
    });
    createSyncContext.mockReset().mockResolvedValue({
      urls: new Set<string>(),
      keys: new Set<string>(),
      currentId: 3,
    });
    knownEmployerName.mockReset().mockReturnValue(null);
    analyzeLink.mockReset().mockResolvedValue(null);
    prompt.mockReset();
    store.urls = new Set();
    store.companies = [];
    store.opportunities = [];
    store.savedUrls = undefined;
    store.savedCompanies = undefined;
    store.savedOpportunities = undefined;
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.fatal).mockClear();
    setTty(false);
  });

  afterEach(() => {
    setTty(undefined);
  });

  it("adds one known link after prompting for the fields a URL cannot supply", async () => {
    setTty(true);
    knownEmployerName.mockReturnValue("Acme");
    prompt.mockResolvedValue({ role: "Intern", location: "Austin, TX" });

    await addJob({ links: [alpha] });

    expect(prompt).toHaveBeenCalledOnce();
    const questions = prompt.mock.calls[0]?.[0] as Array<{ name: string }>;
    expect(questions.map((question) => question.name)).toEqual(["role", "location"]);
    expect(processJobs).toHaveBeenCalledWith({
      jobs: [{ company: "Acme", role: "Intern", location: "Austin, TX", link: alpha }],
      urls: new Set(),
      keys: new Set(),
      currentId: 3,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { added: 1, skipped: 0, failed: 0 },
      "Job add finished"
    );
    expect(analyzeLink).not.toHaveBeenCalled();
  });

  it("prompts once per link and ingests the whole list together", async () => {
    setTty(true);
    knownEmployerName.mockImplementation((link: string) => (link === alpha ? "Acme" : null));
    prompt
      .mockResolvedValueOnce({ role: "Intern", location: "Austin, TX" })
      .mockResolvedValueOnce({ company: "Beta", role: "Analyst", location: "Remote" });

    await addJob({ links: [alpha, beta] });

    expect(processJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: [
          { company: "Acme", role: "Intern", location: "Austin, TX", link: alpha },
          { company: "Beta", role: "Analyst", location: "Remote", link: beta },
        ],
      })
    );
  });

  it("ingests one object or many objects from a single JSON file", async () => {
    const one = path.join(directory, "one.json");
    const many = path.join(directory, "many.json");
    const job = { company: "Acme", role: "Intern", location: "Austin, TX", link: alpha };
    await writeFile(one, JSON.stringify(job));
    await writeFile(
      many,
      JSON.stringify([job, { ...job, company: "Beta", role: "Analyst", link: beta }])
    );

    await addJob({ file: one });
    await addJob({ file: many });

    expect(processJobs).toHaveBeenNthCalledWith(1, expect.objectContaining({ jobs: [job] }));
    expect(processJobs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        jobs: [job, { company: "Beta", role: "Analyst", location: "Austin, TX", link: beta }],
      })
    );
    expect(knownEmployerName).not.toHaveBeenCalled();
  });

  it("rejects an invalid URL, an invalid file, and missing fields without ingesting", async () => {
    const exit = exitOnDemand();
    await expect(addJob({ links: ["not a url"] })).rejects.toThrow("exit:1");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Invalid URL: not a url"));

    const broken = path.join(directory, "broken.json");
    await writeFile(broken, JSON.stringify({ company: "Acme" }));
    await expect(addJob({ file: broken })).rejects.toThrow("exit:1");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Invalid job at index 0"));

    knownEmployerName.mockReturnValue("Acme");
    await expect(addJob({ links: [alpha] })).rejects.toThrow("exit:1");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(`Missing role, location for ${alpha}`)
    );
    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining("Missing company, role"));
    expect(processJobs).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("prints each analyzed JD and does not write stored jobs", async () => {
    analyzeLink
      .mockResolvedValueOnce({ location: "Austin, TX" })
      .mockResolvedValueOnce({ location: "Remote" });

    await analyzeJobs([alpha, beta]);

    expect(analyzeLink).toHaveBeenNthCalledWith(1, alpha);
    expect(analyzeLink).toHaveBeenNthCalledWith(2, beta);
    expect(logger.info).toHaveBeenCalledWith(
      { url: alpha },
      "\n ✏️ Result:\n%s",
      JSON.stringify({ location: "Austin, TX" }, null, 2)
    );
    expect(processJobs).not.toHaveBeenCalled();
    expect(store.savedUrls).toBeUndefined();
    expect(store.savedCompanies).toBeUndefined();
    expect(store.savedOpportunities).toBeUndefined();
  });

  it("deletes every exact URL from a repeated link list or one URL file after the whole input is valid", async () => {
    store.urls = new Set([alpha, beta, similar]);
    store.companies = [
      {
        name: "Example",
        ats: "greenhouse",
        identifier: "example",
        domain: "https://example.com",
        page: "https://example.com/jobs",
        urls: [alpha, beta, similar],
      },
    ];
    store.opportunities = [
      {
        company: "Example",
        role: "Intern",
        link: alpha,
        location: "Austin, TX",
        postedAt: "2026-01-01T00:00:00.000Z",
        expired: false,
      },
      {
        company: "Example",
        role: "Analyst",
        link: beta,
        location: "Remote",
        postedAt: "2026-01-01T00:00:00.000Z",
        expired: false,
      },
      {
        company: "Example",
        role: "Intern",
        link: similar,
        location: "Austin, TX",
        postedAt: "2026-01-01T00:00:00.000Z",
        expired: false,
      },
    ];

    await deleteUrls({ links: [alpha, beta] });

    expect([...(store.savedUrls ?? [])]).toEqual([similar]);
    expect(store.savedCompanies?.[0]?.urls).toEqual([similar]);
    expect(store.savedOpportunities?.map((row) => row.link)).toEqual([similar]);

    store.savedUrls = undefined;
    store.savedCompanies = undefined;
    store.savedOpportunities = undefined;
    const urls = path.join(directory, "urls.txt");
    await writeFile(urls, `${alpha}\nnot a url\n`);
    const exit = exitOnDemand();
    await expect(deleteUrls({ file: urls })).rejects.toThrow("exit:1");
    expect(store.savedUrls).toBeUndefined();
    expect(logger.fatal).toHaveBeenCalledWith(expect.stringContaining("Invalid URL: not a url"));
    exit.mockRestore();

    store.urls = new Set([alpha, similar]);
    await writeFile(urls, `\n${alpha}\n`);
    await deleteUrls({ file: urls });
    expect([...(store.savedUrls ?? [])]).toEqual([similar]);
  });
});
