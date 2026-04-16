import { GREENHOUSE_API_URL } from "@/constants/ats";
import { logger } from "@/utils/logger";

export function parseGreenhouse(url: string) {
  const u = new URL(url);

  // case 1: embed (boards.greenhouse.io)
  const jobIdFromQuery = u.searchParams.get("gh_jid");
  const companyFromQuery = u.searchParams.get("for");

  if (jobIdFromQuery && companyFromQuery) {
    return {
      company: companyFromQuery,
      jobId: jobIdFromQuery,
    };
  }

  // case 2: custom domain with gh_jid (e.g. jumptrading)
  if (jobIdFromQuery) {
    const hostname = u.hostname;
    const company = hostname.replace(/^www\./, "").split(".")[0];

    return {
      company,
      jobId: jobIdFromQuery,
    };
  }

  // case 3: normal greenhouse path
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length >= 3 && parts[1] === "jobs") {
    return {
      company: parts[0],
      jobId: parts[2],
    };
  }

  return null;
}

export async function fetchGreenhouseJD(url: string) {
  const parsed = parseGreenhouse(url);
  if (!parsed) return null;

  const { company, jobId } = parsed;

  const apiUrl = `${GREENHOUSE_API_URL}/${company}/jobs/${jobId}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) {
      logger.error({ apiUrl, statusText: res.statusText }, "❌ Failed to fetch greenhouse JD");
      return null;
    }

    const data = await res.json();
    if (!data) return null;
    return JSON.stringify(data);
  } catch (error) {
    logger.error({ err: error, apiUrl }, "❌ Error fetching greenhouse JD");
    return null;
  }
}
