import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Board } from "../employer";

import { logListingStatus } from "@/modules/employer/failure";
import { formatCompanyName } from "@/utils/company-name";
import { logger } from "@/utils/logger";

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

export class LeverBoard extends Board<LeverJob> {
  readonly ats = "lever" as const;

  companyKeyFromUrl(url: URL): string {
    return this.keyOf(this.getIdentifier(url));
  }

  formCompany(url: URL): Company {
    const page = url.origin.includes("eu")
      ? "https://api.eu.lever.co/v0/postings"
      : "https://api.lever.co/v0/postings";

    const identifier = this.getIdentifier(url);

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

  private getIdentifier(url: URL): string {
    return url.pathname.split("/").filter(Boolean)[0];
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
      company: formatCompanyName(company.name),
      role: job.text,
      link: this.getJobLink(job, company),
      location: job.categories?.location ?? "",
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetch(company.page, {
        signal,
      });

      if (!res.ok) {
        await logListingStatus("Lever", company, res);
        return [];
      }

      const rawJobs = this.getJobsFromResponse(await res.json());

      return this.screen(
        rawJobs.map((job) => this.posting(job, company, job.createdAt)),
        knownKeys,
        { recent: true }
      ).map((posting) => posting.toJob());
    } catch (error) {
      return this.failSoft("Lever", company, error);
    }
  }
}

export const leverBoard = new LeverBoard();
