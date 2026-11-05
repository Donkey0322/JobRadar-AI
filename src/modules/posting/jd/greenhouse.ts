import { AsyncLocalStorage } from "node:async_hooks";
import z from "zod";

import { GREENHOUSE_API_URL } from "@/constants/ats";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";
import { createJDFetchSignal } from "./signal";

import {
  greenhouseCareerSiteJobId,
  resolveGreenhouseIdentifier,
} from "@/modules/ats/greenhouse";

const BoardJobSchema = z.object({
  jobs: z.array(z.object({ id: z.number(), title: z.string() })),
});

type BoardJob = z.infer<typeof BoardJobSchema>["jobs"][number];

const SLUG_LIST_TIMEOUT_MS = 60_000;

interface SlugCache {
  jobs: Map<string, Promise<BoardJob[] | null>>;
  requests: number;
}

const slugCacheStorage = new AsyncLocalStorage<SlugCache>();

function currentSlugCache(): SlugCache | undefined {
  return slugCacheStorage.getStore();
}

/**
 * Share one board jobs-list fetch for this async execution only.
 * A parallel clean run gets its own store. Calls outside a run do not.
 * A failed or aborted fetch is dropped from that store.
 * The shared fetch uses its own timeout, so one caller's AbortSignal cannot
 * cancel another URL or a later run.
 */
export function runWithGreenhouseSlugCache<T>(task: () => Promise<T>): Promise<T> {
  return slugCacheStorage.run({ jobs: new Map(), requests: 0 }, task);
}

/** Board jobs-list requests started by the clean run that is currently executing. */
export function greenhouseSlugRequestCount(): number {
  return currentSlugCache()?.requests ?? 0;
}

async function loadBoardJobs(
  company: string,
  signal: AbortSignal | undefined
): Promise<BoardJob[] | null> {
  try {
    const response = await fetch(`${GREENHOUSE_API_URL}/${company}/jobs`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const parsed = BoardJobSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    return parsed.data.jobs;
  } catch {
    return null;
  }
}

function boardJobs(company: string, signal?: AbortSignal): Promise<BoardJob[] | null> {
  const cache = currentSlugCache();
  if (!cache) return loadBoardJobs(company, signal);

  const cached = cache.jobs.get(company);
  if (cached) return cached;

  cache.requests += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLUG_LIST_TIMEOUT_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  const pending = loadBoardJobs(company, controller.signal).then(
    (jobs) => {
      if (jobs === null) cache.jobs.delete(company);
      return jobs;
    },
    () => {
      cache.jobs.delete(company);
      return null;
    }
  );
  pending.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer)
  );
  cache.jobs.set(company, pending);
  return pending;
}

/** WordPress-style slug: punctuation drops out, words stay hyphenated. */
function titleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function jobIdFromBoardSlug(
  company: string,
  slug: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/.test(slug)) return null;

  const jobs = await boardJobs(company, signal);
  if (!jobs) return null;

  const matches = jobs.filter((job) => titleSlug(job.title) === slug);
  if (matches.length !== 1 || matches[0] === undefined) return null;

  return String(matches[0].id);
}

export async function parseGreenhouse(url: string, signal?: AbortSignal) {
  const u = new URL(url);
  const company = await resolveGreenhouseIdentifier(u);
  const jobIdFromQuery = u.searchParams.get("gh_jid");
  if (jobIdFromQuery) {
    return {
      company,
      jobId: jobIdFromQuery,
    };
  }

  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length >= 3 && parts[1] === "jobs" && parts[2]) {
    return {
      company,
      jobId: parts[2],
    };
  }

  const careerSiteJobId = greenhouseCareerSiteJobId(u);
  if (careerSiteJobId) {
    return { company, jobId: careerSiteJobId };
  }

  const slug = parts.at(-1);
  if (slug) {
    const jobId = await jobIdFromBoardSlug(company, slug, signal);
    if (jobId) {
      return { company, jobId };
    }
  }

  return null;
}

export async function fetchGreenhouseJD(
  url: string,
  signal: AbortSignal = createJDFetchSignal()
): Promise<JDFetchResult> {
  const parsed = await parseGreenhouse(url, signal);
  if (!parsed) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Greenhouse URL") };
  }

  const { company, jobId } = parsed;
  const apiUrl = `${GREENHOUSE_API_URL}/${company}/jobs/${jobId}`;

  return fetchJD(apiUrl, signal, { logLabel: "greenhouse JD" });
}
