import { GREENHOUSE_API_URL } from "@/constants/ats";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

import { urlToGreenhouseCompany } from "@/modules/company-tacker/ats/greenhouse";

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

export async function fetchGreenhouseJD(url: string, signal: AbortSignal): Promise<JDFetchResult> {
  const parsed = await parseGreenhouse(url);
  if (!parsed) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Greenhouse URL") };
  }

  const { company, jobId } = parsed;
  const apiUrl = `${GREENHOUSE_API_URL}/${company}/jobs/${jobId}`;

  return fetchJD(apiUrl, signal, { logLabel: "greenhouse JD" });
}
