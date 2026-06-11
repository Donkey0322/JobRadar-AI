import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { AshbyJob } from "@/modules/company-tacker/ats/ashby";

import { logger } from "@/utils/logger";

export async function fetchAshbyJD(url: string, signal: AbortSignal) {
  const u = new URL(url);
  const identifier = u.pathname.split("/")[1];

  const id = u.pathname.split("/")[2];

  const apiUrl = `${ASHBY_API_URL}/${identifier}`;

  try {
    const res = await fetch(apiUrl, { signal });
    if (!res.ok) {
      logger.error({ apiUrl, statusText: res.statusText }, `${RED_CROSS} Failed to fetch ashby JD`);
      return null;
    }

    const data: { jobs: AshbyJob[] } = await res.json();
    const jd = data.jobs.find((job: AshbyJob) => job.id === id) ?? null;
    if (!jd) return null;
    return JSON.stringify(jd);
  } catch (error) {
    logger.error({ err: error, apiUrl }, `${RED_CROSS} Error fetching ashby JD`);
    return null;
  }
}
