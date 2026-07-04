import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

export function urlToEightfoldCompany(url: URL): Company {
  const identifier = url.hostname.replace(".eightfold.ai", "");

  const domain = url.searchParams.get("domain") ?? `${identifier}.com`;

  return {
    name: identifier,
    ats: "eightfold",
    identifier,
    domain,
    page: `${url.origin}/api/pcsx/search?domain=${domain}`,
    urls: [],
  };
}

export const EightfoldJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  locations: z.array(z.string()),
  creationTs: z.number(),
  postedTs: z.number(),
  positionUrl: z.string(),
});

type EightfoldJob = z.infer<typeof EightfoldJobSchema>;

export const EightfoldResponseSchema = z.object({
  data: z
    .object({
      positions: z.array(EightfoldJobSchema).optional(),
    })
    .optional(),
});

function getEightfoldJobsFromResponse(data: unknown): EightfoldJob[] {
  const parsed = EightfoldResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Eightfold response`);

    return [];
  }

  return parsed.data.data?.positions ?? [];
}

const getEightfoldJobLink = (company: Company, job: EightfoldJob): string => {
  return `${company.domain}${job.positionUrl}`;
};

function normalizeEightfoldJob(job: EightfoldJob, company: Company): Job {
  const role = job.name;
  const link = getEightfoldJobLink(company, job);
  const location = job.locations.join(", ");

  return {
    company: capitalize(company.name),
    role,
    link,
    location,
  };
}

const PAGE_SIZE = 10;
const MAX_PAGES = 200;

export async function fetchEightfold(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  const allJobs: Job[] = [];

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * PAGE_SIZE;
      const url = new URL(company.page);

      url.searchParams.set("query", "");
      url.searchParams.set("location", "");
      url.searchParams.set("start", String(start));
      url.searchParams.set("sort_by", "timestamp");

      const res = await fetch(url.toString(), {
        signal,
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-US,en;q=0.9",
          referer: `${company.domain}/careers?start=${start}&sort_by=timestamp`,
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        await appendErrorLog(`Eightfold: ${company.name} - ${res.status} - ${res.statusText}`);
        break;
      }

      const rawJobs = getEightfoldJobsFromResponse(await res.json());

      if (rawJobs.length === 0) break;

      let reachedOldJob = false;

      const opportunities = rawJobs
        .filter((job) => {
          if (job.postedTs && !withinDays(job.postedTs)) {
            reachedOldJob = true;
            return false;
          }

          const link = getEightfoldJobLink(company, job);
          return !!(job.name && link && isTarget(job.name) && !urls.has(link));
        })
        .map((job) => normalizeEightfoldJob(job, company));

      allJobs.push(...opportunities);

      if (rawJobs.length < PAGE_SIZE || reachedOldJob) break;
    }

    return allJobs;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ Eightfold request aborted"
      );

      return [];
    }

    logger.error(
      {
        error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching eightfold jobs`
    );

    return [];
  }
}
