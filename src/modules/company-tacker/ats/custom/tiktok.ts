import { ABORT_SIGNAL } from "@/constants";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

type TikTokJobPost = {
  id: string;
  title: string;
  city_info?: {
    en_name?: string;
    name?: string;
  };
};

type TikTokSearchResponse = {
  code: number;
  message?: string;
  data?: {
    total?: number;
    job_post_list?: TikTokJobPost[];
  };
};

export async function fetchTikTok(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  const res = await fetch(company.page, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "en-US",
      "content-type": "application/json",
      origin: "https://lifeattiktok.com",
      referer: "https://lifeattiktok.com/",
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

  const json = (await res.json()) as TikTokSearchResponse;

  if (json.code !== 0) {
    return [];
  }

  const posts = json.data?.job_post_list ?? [];

  return posts
    .filter((post) => post.id && post.title)
    .map((post) => {
      const url = `https://lifeattiktok.com/search/${post.id}`;

      return {
        company: company.name,
        role: post.title,
        link: url,
        location: post.city_info?.en_name ?? post.city_info?.name ?? "Unsure",
      };
    })
    .filter((job) => isTarget(job.role) && !urls.has(job.link));
}
