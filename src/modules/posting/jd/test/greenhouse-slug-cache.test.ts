import { afterEach, describe, expect, it, vi } from "vitest";

import {
  greenhouseSlugRequestCount,
  parseGreenhouse,
  runWithGreenhouseSlugCache,
} from "../greenhouse";

const slugA = "https://job-boards.greenhouse.io/acme/software-engineer-intern";
const slugB = "https://job-boards.greenhouse.io/acme/data-scientist-intern";

const jobs = {
  jobs: [
    { id: 11, title: "Software Engineer Intern" },
    { id: 22, title: "Data Scientist Intern" },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

async function flush() {
  for (let step = 0; step < 8; step++) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("greenhouse slug listing cache", () => {
  it("fetches the board jobs list once for two slugs in the same run", async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let seen: AbortSignal | undefined;
    const caller = new AbortController();

    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      calls++;
      seen = init?.signal ?? undefined;
      return gate;
    });

    await runWithGreenhouseSlugCache(async () => {
      const first = parseGreenhouse(slugA, caller.signal);
      const second = parseGreenhouse(slugB, caller.signal);
      await flush();

      expect(calls).toBe(1);
      expect(greenhouseSlugRequestCount()).toBe(1);
      caller.abort();
      expect(seen?.aborted).toBe(false);
      expect(seen).not.toBe(caller.signal);

      release(json(jobs));
      await expect(first).resolves.toEqual({ company: "acme", jobId: "11" });
      await expect(second).resolves.toEqual({ company: "acme", jobId: "22" });
    });
  });

  it("gives each overlapping run its own jobs-list fetch and count", async () => {
    let calls = 0;
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let ready = 0;
    let markReady: () => void = () => {};
    const readyGate = new Promise<void>((resolve) => {
      markReady = () => {
        ready++;
        if (ready === 2) resolve();
      };
    });
    vi.stubGlobal("fetch", () => {
      calls++;
      return gate;
    });

    const run = () =>
      runWithGreenhouseSlugCache(async () => {
        const pending = parseGreenhouse(slugA);
        await flush();
        const count = greenhouseSlugRequestCount();
        markReady();
        await pending;
        return count;
      });

    const pending = Promise.all([run(), run()]);
    try {
      await readyGate;
      expect(calls).toBe(2);
      release(json(jobs));
      await expect(pending).resolves.toEqual([1, 1]);
    } finally {
      release(json(jobs));
    }
  });

  it("refetches after a failed or aborted listing instead of keeping it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }))
      .mockResolvedValueOnce(new Response("", { status: 500, statusText: "Internal Server Error" }))
      .mockResolvedValueOnce(json(jobs));
    vi.stubGlobal("fetch", fetchMock);

    await runWithGreenhouseSlugCache(async () => {
      await expect(parseGreenhouse(slugA)).resolves.toBeNull();
      await expect(parseGreenhouse(slugA)).resolves.toBeNull();
      await expect(parseGreenhouse(slugA)).resolves.toEqual({ company: "acme", jobId: "11" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(greenhouseSlugRequestCount()).toBe(3);
    });
  });

  it("does not reuse a slug listing after the run cache closes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(jobs));
    vi.stubGlobal("fetch", fetchMock);

    await runWithGreenhouseSlugCache(() => parseGreenhouse(slugA));
    expect(greenhouseSlugRequestCount()).toBe(0);

    await runWithGreenhouseSlugCache(async () => {
      await parseGreenhouse(slugB);
      expect(greenhouseSlugRequestCount()).toBe(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the caller signal when no run cache is open", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return Promise.resolve(json(jobs));
    });
    const caller = new AbortController();

    await expect(parseGreenhouse(slugA, caller.signal)).resolves.toEqual({
      company: "acme",
      jobId: "11",
    });
    await expect(parseGreenhouse(slugB, caller.signal)).resolves.toEqual({
      company: "acme",
      jobId: "22",
    });

    expect(seen).toBe(caller.signal);
  });
});
