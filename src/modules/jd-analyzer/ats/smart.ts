import { SMART_RECRUITERS_API_URL } from "@/constants/ats";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

import { getLastPathNumber } from "@/modules/job-dedup/utils";

export async function fetchSmartRecruitersJD(
  url: string,
  signal: AbortSignal
): Promise<JDFetchResult> {
  const u = new URL(url);

  const id = getLastPathNumber(u.pathname);
  if (!id) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid SmartRecruiters URL") };
  }

  const parts = u.pathname.split("/").filter(Boolean);
  const identifier = parts[0];
  const apiUrl = `${SMART_RECRUITERS_API_URL}/${identifier}/postings/${id}`;

  return fetchJD(apiUrl, signal, { logLabel: "smart recruiters JD" });
}
