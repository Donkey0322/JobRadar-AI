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

interface AmazonJobResponse {
  searchHits: {
    fields: AmazonJob;
  }[];
}

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

function getAmazonJobsFromResponse(data: AmazonJobResponse): AmazonJob[] {
  return data.searchHits.map(({ fields }) => fields);
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

    const data: AmazonJobResponse = (await res.json()) as AmazonJobResponse;
    const rawJobs = getAmazonJobsFromResponse(data);
    const jobs: Job[] = [];

    for (const rawJob of rawJobs) {
      const parsed = AmazonJobSchema.safeParse(rawJob);

      if (!parsed.success) {
        logger.error(
          { job: rawJob, issues: parsed.error.issues },
          `${RED_CROSS} Invalid Amazon job`
        );

        continue;
      }

      const amazonJob = parsed.data;
      const title = amazonJob.title?.[0] ?? "";
      const link = `${AMAZON_CAREERS_URL}/en/jobs/${amazonJob.icimsJobId?.[0]}`;

      if (
        !isTarget(title) ||
        urls.has(link) ||
        (!withinDays(amazonJob.createdDate?.[0]) && !withinDays(amazonJob.updatedDate?.[0]))
      ) {
        continue;
      }

      jobs.push(normalizeAmazonJob(amazonJob));
    }

    return jobs;
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
