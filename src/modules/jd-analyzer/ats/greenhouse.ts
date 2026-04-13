import { GREENHOUSE_API_URL } from "@/constants/ats";

export function parseGreenhouse(url: string) {
  const u = new URL(url);

  // case 1: embed
  const jobIdFromQuery = u.searchParams.get("gh_jid");
  const companyFromQuery = u.searchParams.get("for");

  if (jobIdFromQuery && companyFromQuery) {
    return {
      company: companyFromQuery,
      jobId: jobIdFromQuery,
    };
  }

  // case 2: normal path
  const parts = u.pathname.split("/").filter(Boolean);

  // /stripe/jobs/1234567
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
      console.error(`Failed to fetch greenhouse JD from ${apiUrl}: ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    return JSON.stringify(data);
  } catch (error) {
    console.error(`Error fetching greenhouse JD from ${apiUrl}: ${error}`);
    return null;
  }
}
