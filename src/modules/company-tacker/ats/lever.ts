import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const identifierToLeverCompany = {
  InfrastructureandCapitalProjects: "accenture",
};

export function urlToLeverCompany(url: URL): Company {
  const page = url.origin.includes("eu")
    ? "https://api.eu.lever.co/v0/postings"
    : "https://api.lever.co/v0/postings";

  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];

  const companyName =
    identifierToLeverCompany[identifier as keyof typeof identifierToLeverCompany] ?? identifier;

  return {
    name: companyName,
    ats: "lever",
    identifier,
    domain: url.origin,
    page: `${page}/${identifier}?mode=json`,
    urls: [],
  };
}

export const LeverJobSchema = z.object({
  text: z.string(),
  hostedUrl: z.string(),
  createdAt: z.number(),
  categories: z.object({ location: z.string().optional() }).optional(),
});

type LeverJob = z.infer<typeof LeverJobSchema>;

export const LeverResponseSchema = z.array(LeverJobSchema);

function getLeverJobsFromResponse(data: unknown): LeverJob[] {
  const parsed = LeverResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Lever response`);

    return [];
  }

  return parsed.data;
}

function normalizeLeverJob(job: LeverJob, companyName: string): Job {
  return {
    company: capitalize(companyName),
    role: job.text,
    link: job.hostedUrl,
    location: job.categories?.location ?? "",
  };
}

export async function fetchLever(company: Company, urls: Set<string>, signal: AbortSignal) {
  try {
    const res = await fetch(company.page, {
      signal,
    });

    if (!res.ok) {
      await appendErrorLog(`Lever: ${company.name} - ${res.status} - ${res.statusText}`);

      return [];
    }

    const rawJobs = getLeverJobsFromResponse(await res.json());

    const opportunities = rawJobs
      .filter((job) => isTarget(job.text) && !urls.has(job.hostedUrl) && withinDays(job.createdAt))
      .map((job) => normalizeLeverJob(job, company.name));

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
