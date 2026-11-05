import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Company, Opportunity } from "@/types";

const store = vi.hoisted(() => ({
  urls: new Set<string>(),
  companies: [] as Company[],
  opportunities: [] as Opportunity[],
  savedUrls: undefined as Set<string> | undefined,
  savedCompanies: undefined as Company[] | undefined,
  savedOpportunities: undefined as Opportunity[] | undefined,
}));

vi.mock("@/store", () => ({
  urls: {
    load: vi.fn(async () => store.urls),
    save: vi.fn(async (urls: Set<string>) => {
      store.savedUrls = urls;
    }),
  },
  companies: {
    load: vi.fn(async () => store.companies),
    save: vi.fn(async (companies: Company[]) => {
      store.savedCompanies = companies;
    }),
  },
  opportunities: {
    load: vi.fn(async () => store.opportunities),
    replace: vi.fn(async (opportunities: Opportunity[]) => {
      store.savedOpportunities = opportunities;
    }),
  },
  jobs: {
    load: vi.fn(async () => []),
  },
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), level: "info" },
}));

import { deleteUrl } from "../../delete-url";
import { addJob } from "../../link";

function runScript(script: string, ...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8" });
}

describe("maintenance argument handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid link from job add and from the old script", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((status?: number) => {
      throw new Error(`exit:${status}`);
    }) as typeof process.exit);

    await expect(addJob(["-l", "not a url"])).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();

    const old = runScript("scripts/link.ts", "-l", "not a url");
    expect(old.status).toBe(1);
  }, 20_000);

  it("rejects -l together with -f", async () => {
    vi.spyOn(process, "exit").mockImplementation(((status?: number) => {
      throw new Error(`exit:${status}`);
    }) as typeof process.exit);

    await expect(addJob(["-l", "https://example.com/jobs/1", "-f", "scripts/job.json"])).rejects.toThrow(
      "exit:1"
    );
  });

  it("rejects urls delete without a link, including the old script", async () => {
    vi.spyOn(process, "exit").mockImplementation(((status?: number) => {
      throw new Error(`exit:${status}`);
    }) as typeof process.exit);

    await expect(deleteUrl([])).rejects.toThrow("exit:1");

    const old = runScript("scripts/delete-url.ts");
    expect(old.status).toBe(1);
  }, 20_000);

  it("deletes only the exact URL and leaves a different spelling in place", async () => {
    const exact = "https://example.com/jobs/1";
    const similar = "https://example.com/jobs/1/";
    store.urls = new Set([exact, similar]);
    store.companies = [
      {
        name: "Example",
        ats: "greenhouse",
        identifier: "example",
        domain: "https://example.com",
        page: "https://job-boards.greenhouse.io/example",
        urls: [exact, similar],
      },
    ];
    store.opportunities = [
      {
        company: "Example",
        role: "Intern",
        link: exact,
        location: "Austin, TX",
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
    await deleteUrl(["-l", exact]);

    expect([...(store.savedUrls ?? [])]).toEqual([similar]);
    expect(store.savedCompanies?.[0]?.urls).toEqual([similar]);
    expect(store.savedOpportunities?.map((row) => row.link)).toEqual([similar]);
  });
});
