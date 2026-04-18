import { SMART_RECRUITERS_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import { getLastPathNumber } from "@/modules/job-dedup/utils";
import { logger } from "@/utils/logger";

export async function fetchSmartRecruitersJD(url: string) {
  const u = new URL(url);

  const id = getLastPathNumber(u.pathname);
  if (!id) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  const identifier = parts[0];
  const apiUrl = `${SMART_RECRUITERS_API_URL}/${identifier}/postings/${id}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data) return null;
    return JSON.stringify(data);
  } catch (error) {
    logger.error({ err: error, apiUrl }, `${RED_CROSS} Error fetching smart recruiters JD`);
    return null;
  }
}
