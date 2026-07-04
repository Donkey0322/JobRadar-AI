import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "@/modules/company-tacker/utils";
import { logger } from "@/utils/logger";

const AMAZON_CAREERS_URL = "https://amazon.jobs";
const AMAZON_API_URL = "https://amazon.jobs/api/jobs/search?is_als=true";

export const AmazonCompany = {
  name: "Amazon",
  ats: "custom",
  identifier: "amazon",
  domain: "https://amazon.jobs",
  page: AMAZON_API_URL,
  urls: [],
} as const satisfies Company;

export const AmazonJobSchema = z.object({
  title: z.array(z.string()),
  url: z.string().optional(),
  location: z.array(z.string()),
  createdDate: z.array(z.string()),
  updatedDate: z.array(z.string()),
  icimsJobId: z.array(z.string()),
});

type AmazonJob = z.infer<typeof AmazonJobSchema>;

export const AmazonResponseSchema = z.object({
  searchHits: z.array(z.object({ fields: AmazonJobSchema })),
});

const REQUEST = {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    size: 100,
    start: 0,
    sort: { sortOrder: "DESCENDING", sortType: "CREATED_DATE" },
  }),
};

function getAmazonJobsFromResponse(data: unknown): AmazonJob[] {
  const parsed = AmazonResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Amazon response`);

    return [];
  }

  return parsed.data.searchHits.map(({ fields }) => fields);
}

function normalizeAmazonJob(job: AmazonJob): Job {
  return {
    company: "Amazon",
    role: job.title?.[0] ?? "",
    link: `${AMAZON_CAREERS_URL}/en/jobs/${job.icimsJobId?.[0]}`,
    location: job.location?.[0] ?? "",
  };
}

export async function fetchAmazon(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const res = await fetch(company.page, {
      ...REQUEST,
      signal,
    });

    const rawJobs = getAmazonJobsFromResponse(await res.json());

    const opportunities = rawJobs
      .filter((job) => {
        const title = job.title?.[0] ?? "";
        const link = `${AMAZON_CAREERS_URL}/en/jobs/${job.icimsJobId?.[0]}`;

        return (
          isTarget(title) &&
          !urls.has(link) &&
          (withinDays(job.createdDate?.[0]) || withinDays(job.updatedDate?.[0]))
        );
      })
      .map(normalizeAmazonJob);

    return opportunities;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.error(
        { err: error.name, company: company.name, url: company.page },
        `${RED_CROSS} Error fetching amazon jobs`
      );

      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching amazon jobs`);

    return [];
  }
}
