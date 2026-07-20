import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { ATSFetcher } from "./class";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

export const TRACKING_PARAM = "8fold_id";

const domainMap = {
  "searchcareers.caci.com": "caci.com",
  "apply.careers.microsoft.com": "microsoft.com",
};

export const EightfoldJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  locations: z.array(z.string()),
  creationTs: z.number(),
  postedTs: z.number(),
  positionUrl: z.string(),
});

export type EightfoldJob = z.infer<typeof EightfoldJobSchema>;

export const EightfoldPcsxResponseSchema = z.object({
  data: z
    .object({
      positions: z.array(EightfoldJobSchema).optional(),
    })
    .optional(),
});

export const EightfoldApplyJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  locations: z.array(z.string()),
  t_create: z.number(),
  t_update: z.number().optional(),
  canonicalPositionUrl: z.string(),
});

export const EightfoldApplyResponseSchema = z.object({
  positions: z.array(EightfoldApplyJobSchema).optional(),
});

const PAGE_SIZE = 10;
const MAX_PAGES = 200;

export class EightfoldFetcher extends ATSFetcher<EightfoldJob> {
  readonly ats = "eightfold" as const;

  async formCompany(url: URL): Promise<Company> {
    const identifier = url.hostname.replace(".eightfold.ai", "");
    const domain =
      url.searchParams.get("domain") ??
      domainMap[url.hostname as keyof typeof domainMap] ??
      `${identifier}.com`;

    let page = `${url.origin}/api/pcsx/search?domain=${domain}`;
    const response = await fetch(page);
    const data = (await response.json()) as { message?: string };

    if (data.message === "PCSX is not enabled for this user.") {
      page = `${url.origin}/api/apply/v2/jobs?domain=${domain}`;
    }

    return {
      name: identifier,
      ats: this.ats,
      identifier,
      domain,
      page,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): EightfoldJob[] {
    const pcsxParsed = EightfoldPcsxResponseSchema.safeParse(data);

    if (pcsxParsed.success && pcsxParsed.data.data?.positions) {
      return pcsxParsed.data.data.positions;
    }

    const applyParsed = EightfoldApplyResponseSchema.safeParse(data);

    if (applyParsed.success) {
      return (applyParsed.data.positions ?? []).map((job) => ({
        id: job.id,
        name: job.name,
        locations: job.locations,
        creationTs: job.t_create,
        postedTs: job.t_update ?? job.t_create,
        positionUrl: new URL(job.canonicalPositionUrl).pathname,
      }));
    }

    logger.error(
      { data, issues: applyParsed.error.issues },
      `${RED_CROSS} Invalid Eightfold response`
    );
    return [];
  }

  protected getJobLink(job: EightfoldJob, company: Company): string {
    const url = new URL(company.page);
    url.pathname = job.positionUrl.startsWith("/") ? job.positionUrl : `/${job.positionUrl}`;
    url.searchParams.set(TRACKING_PARAM, String(job.id));
    return url.toString();
  }

  protected normalizeJob(job: EightfoldJob, company: Company): Job {
    return {
      company: capitalize(company.name),
      role: job.name,
      link: this.getJobLink(job, company),
      location: job.locations.join(", "),
    };
  }

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
    const allJobs: Job[] = [];

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const start = page * PAGE_SIZE;
        const url = new URL(company.page);

        url.searchParams.set("query", "");
        url.searchParams.set("location", "");
        url.searchParams.set("start", String(start));
        url.searchParams.set("sort_by", "timestamp");

        const response = await fetch(url.toString(), {
          signal,
          headers: {
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            referer: `${company.domain}/careers?start=${start}&sort_by=timestamp`,
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          await appendErrorLog(
            `Eightfold: ${company.name} - ${response.status} - ${response.statusText}`
          );
          break;
        }

        const rawJobs = this.getJobsFromResponse(await response.json());
        if (rawJobs.length === 0) break;

        let reachedOldJob = false;
        const opportunities = rawJobs
          .filter((job) => {
            if (job.postedTs && !withinDays(job.postedTs)) {
              reachedOldJob = true;
              return false;
            }

            const link = this.getJobLink(job, company);
            return !!(job.name && link && isTarget(job.name) && !urls.has(link));
          })
          .map((job) => this.normalizeJob(job, company));

        allJobs.push(...opportunities);
        if (rawJobs.length < PAGE_SIZE || reachedOldJob) break;
      }

      return allJobs;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
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
}

export const eightfoldFetcher = new EightfoldFetcher();
