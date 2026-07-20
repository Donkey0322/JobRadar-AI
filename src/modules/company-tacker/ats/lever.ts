import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { ATSFetcher } from "./class";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const identifierToLeverCompany = {
  InfrastructureandCapitalProjects: "accenture",
};

export const LeverJobSchema = z.object({
  text: z.string(),
  hostedUrl: z.string(),
  createdAt: z.number(),
  categories: z.object({ location: z.string().optional() }).optional(),
});

export type LeverJob = z.infer<typeof LeverJobSchema>;

export const LeverResponseSchema = z.array(LeverJobSchema);

export class LeverFetcher extends ATSFetcher<LeverJob> {
  readonly ats = "lever" as const;

  formCompany(url: URL): Company {
    const page = url.origin.includes("eu")
      ? "https://api.eu.lever.co/v0/postings"
      : "https://api.lever.co/v0/postings";

    const parts = url.pathname.split("/").filter(Boolean);
    const identifier = parts[0];

    const companyName =
      identifierToLeverCompany[identifier as keyof typeof identifierToLeverCompany] ?? identifier;

    return {
      name: companyName,
      ats: this.ats,
      identifier,
      domain: url.origin,
      page: `${page}/${identifier}?mode=json`,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): LeverJob[] {
    const parsed = LeverResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Lever response`);

      return [];
    }

    return parsed.data;
  }

  protected getJobLink(job: LeverJob, _company: Company): string {
    void _company;
    return job.hostedUrl;
  }

  protected normalizeJob(job: LeverJob, company: Company): Job {
    return {
      company: capitalize(company.name),
      role: job.text,
      link: this.getJobLink(job, company),
      location: job.categories?.location ?? "",
    };
  }

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
    try {
      const res = await fetch(company.page, {
        signal,
      });

      if (!res.ok) {
        await appendErrorLog(`Lever: ${company.name} - ${res.status} - ${res.statusText}`);

        return [];
      }

      const rawJobs = this.getJobsFromResponse(await res.json());

      const opportunities = rawJobs
        .filter(
          (job) =>
            isTarget(job.text) &&
            !urls.has(this.getJobLink(job, company)) &&
            withinDays(job.createdAt)
        )
        .map((job) => this.normalizeJob(job, company));

      return opportunities;
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        logger.warn(
          {
            company: company.name,
            url: company.page,
          },
          "⚠️ Lever request aborted"
        );

        return [];
      }

      logger.error(
        {
          error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching lever jobs`
      );

      return [];
    }
  }
}

export const leverFetcher = new LeverFetcher();
