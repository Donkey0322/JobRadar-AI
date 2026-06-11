import { GREENHOUSE_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import { urlToGreenhouseCompany } from "@/modules/company-tacker/ats/greenhouse";
import { logger } from "@/utils/logger";

export async function parseGreenhouse(url: string) {
  const u = new URL(url);

  const { identifier: company } = await urlToGreenhouseCompany(new URL(url));
  const jobIdFromQuery = u.searchParams.get("gh_jid");
  if (jobIdFromQuery) {
    return {
      company,
      jobId: jobIdFromQuery,
    };
  }

  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length >= 3 && parts[1] === "jobs") {
    return {
      company,
      jobId: parts[2],
    };
  }

  return null;
}

export async function fetchGreenhouseJD(url: string, signal: AbortSignal) {
  const parsed = await parseGreenhouse(url);
  if (!parsed) return null;

  const { company, jobId } = parsed;

  const apiUrl = `${GREENHOUSE_API_URL}/${company}/jobs/${jobId}`;

  try {
    const res = await fetch(apiUrl, { signal });
    if (!res.ok) {
      logger.error(
        { apiUrl, statusText: res.statusText },
        `${RED_CROSS} Failed to fetch greenhouse JD`
      );
      return null;
    }

    const data = await res.json();
    if (!data) return null;
    return JSON.stringify(data);
  } catch (error) {
    logger.error({ err: error, apiUrl }, `${RED_CROSS} Error fetching greenhouse JD`);
    return null;
  }
}
