import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

import { logger } from "@/utils/logger";

const TIKTOK_CAREERS_URL = "https://lifeattiktok.com";
const TIKTOK_API_URL = "https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts";

export const TikTokCompany = {
  name: "TikTok",
  ats: "custom",
  identifier: "tiktok",
  domain: TIKTOK_CAREERS_URL,
  page: TIKTOK_API_URL,
  urls: [],
} as const satisfies Company;

export const TikTokJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  city_info: z
    .object({
      en_name: z.string().nullish(),
      name: z.string().nullish(),
    })
    .nullish(),
});

type TikTokJob = z.infer<typeof TikTokJobSchema>;

export const TikTokResponseSchema = z.object({
  code: z.number(),
  data: z
    .object({
      total: z.number().optional(),
      job_post_list: z.array(TikTokJobSchema),
    })
    .optional(),
});

function getTikTokJobsFromResponse(data: unknown): TikTokJob[] {
  const parsed = TikTokResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid TikTok response`);

    return [];
  }

  if (parsed.data.code !== 0) {
    return [];
  }

  return parsed.data.data?.job_post_list ?? [];
}

const getTikTokJobLink = (job: TikTokJob): string => {
  return `${TIKTOK_CAREERS_URL}/search/${job.id}`;
};

function normalizeTikTokJob(job: TikTokJob): Job {
  return {
    company: "TikTok",
    role: job.title,
    link: getTikTokJobLink(job),
    location: job.city_info?.en_name ?? job.city_info?.name ?? "Unsure",
  };
}

export async function fetchTikTok(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const res = await fetch(company.page, {
      method: "POST",
      headers: {
        accept: "*/*",
        "accept-language": "en-US",
        "content-type": "application/json",
        origin: TIKTOK_CAREERS_URL,
        referer: `${TIKTOK_CAREERS_URL}/`,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "website-path": "tiktok",
      },
      body: JSON.stringify({
        recruitment_id_list: [],
        job_category_id_list: [],
        subject_id_list: [],
        location_code_list: [],
        keyword: "",
        limit: 500,
        offset: 0,
      }),
      signal,
    });

    if (!res.ok) {
      return [];
    }

    const rawJobs = getTikTokJobsFromResponse(await res.json());

    const opportunities = rawJobs
      .filter((job) => isTarget(job.title) && !urls.has(getTikTokJobLink(job)))
      .map(normalizeTikTokJob);

    return opportunities;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.error(
        { err: error.name, company: company.name, url: company.page },
        `${RED_CROSS} Error fetching TikTok jobs`
      );

      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching TikTok jobs`);

    return [];
  }
}
