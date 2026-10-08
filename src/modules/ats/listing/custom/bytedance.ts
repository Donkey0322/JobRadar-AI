import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { isTarget } from "../../core/filter";

import { isKnownJob } from "@/utils/job-key";
import { logger } from "@/utils/logger";

const BYTEDANCE_CAREERS_URL = "https://joinbytedance.com";
const BYTEDANCE_API_URL = "https://jobs.bytedance.com/api/v1/public/supplier/search/job/posts";
const PAGE_SIZE = 1000;
const MAX_PAGES = 8;

export const ByteDanceCompany = {
  name: "ByteDance",
  ats: "custom",
  identifier: "bytedance",
  domain: BYTEDANCE_CAREERS_URL,
  page: BYTEDANCE_API_URL,
  urls: [],
} as const satisfies Company;

export const ByteDanceJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  city_info: z
    .object({
      en_name: z.string().nullish(),
      name: z.string().nullish(),
    })
    .nullish(),
});

type ByteDanceJob = z.infer<typeof ByteDanceJobSchema>;

export const ByteDanceResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      count: z.number().optional(),
      job_post_list: z.array(ByteDanceJobSchema),
    })
    .optional(),
});

function getByteDanceJobsFromResponse(data: unknown): {
  jobs: ByteDanceJob[];
  count: number;
} | null {
  const parsed = ByteDanceResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid ByteDance response`);

    return null;
  }

  if (parsed.data.code !== 0) {
    return null;
  }

  return {
    jobs: parsed.data.data?.job_post_list ?? [],
    count: parsed.data.data?.count ?? 0,
  };
}

const getByteDanceJobLink = (job: ByteDanceJob): string => {
  return `${BYTEDANCE_CAREERS_URL}/search/${job.id}`;
};

function normalizeByteDanceJob(job: ByteDanceJob): Job {
  return {
    company: "ByteDance",
    role: job.title,
    link: getByteDanceJobLink(job),
    location: job.city_info?.en_name ?? job.city_info?.name ?? "Unsure",
  };
}

function searchBody(offset: number) {
  return JSON.stringify({
    recruitment_id_list: [],
    job_category_id_list: [],
    subject_id_list: [],
    location_code_list: [],
    keyword: "",
    limit: PAGE_SIZE,
    offset,
  });
}

async function fetchAllByteDanceJobs(
  company: Company,
  signal: AbortSignal
): Promise<ByteDanceJob[]> {
  const jobs: ByteDanceJob[] = [];
  let offset = 0;
  let count = Number.POSITIVE_INFINITY;

  for (let page = 0; page < MAX_PAGES && offset < count; page++) {
    const res = await fetch(company.page, {
      method: "POST",
      headers: {
        accept: "*/*",
        "accept-language": "en-US",
        "content-type": "application/json",
        origin: BYTEDANCE_CAREERS_URL,
        referer: `${BYTEDANCE_CAREERS_URL}/`,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "website-path": "en",
      },
      body: searchBody(offset),
      signal,
    });

    if (!res.ok) {
      break;
    }

    const pageResult = getByteDanceJobsFromResponse(await res.json());

    if (!pageResult) {
      break;
    }

    jobs.push(...pageResult.jobs);
    count = pageResult.count;

    if (pageResult.jobs.length < PAGE_SIZE) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return jobs;
}

export async function fetchByteDance(
  company: Company,
  knownKeys: ReadonlySet<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const rawJobs = await fetchAllByteDanceJobs(company, signal);

    return rawJobs
      .filter((job) => isTarget(job.title) && !isKnownJob(getByteDanceJobLink(job), knownKeys))
      .map(normalizeByteDanceJob);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.error(
        { err: error.name, company: company.name, url: company.page },
        `${RED_CROSS} Error fetching ByteDance jobs`
      );

      return [];
    }

    logger.error(
      { err: error, company: company.name },
      `${RED_CROSS} Error fetching ByteDance jobs`
    );

    return [];
  }
}
