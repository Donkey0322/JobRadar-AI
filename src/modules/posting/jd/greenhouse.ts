import z from "zod";

import { createJDFetchSignal } from "@/constants";
import { GREENHOUSE_API_URL } from "@/constants/ats";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

import { resolveGreenhouseIdentifier } from "@/modules/employer/shared/greenhouse";

const BoardJobSchema = z.object({
  jobs: z.array(z.object({ id: z.number(), title: z.string() })),
});

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

  try {
    const response = await fetch(`${GREENHOUSE_API_URL}/${company}/jobs`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const parsed = BoardJobSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    const matches = parsed.data.jobs.filter((job) => titleSlug(job.title) === slug);
    if (matches.length !== 1 || matches[0] === undefined) return null;

    return String(matches[0].id);
  } catch {
    return null;
  }
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
