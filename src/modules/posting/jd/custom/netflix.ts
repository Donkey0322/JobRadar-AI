import { createJDFetchSignal } from "@/constants";

import { JD_FETCH_ERROR, JD_FETCH_OK, type JDFetchResult } from "../fetch";

import { getLastPathNumber } from "@/utils/job-key/url";

const NETFLIX_API_URL = "https://explore.jobs.netflix.net/api/apply/v2/jobs";

export async function fetchNetflixJD(
  url: string,
  signal: AbortSignal = createJDFetchSignal()
): Promise<JDFetchResult> {
  const u = new URL(url);
  const jobId = u.searchParams.get("pid") || getLastPathNumber(u.pathname);
  if (!jobId) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.invalidUrl("Job ID not found"),
    };
  }

  const res = await fetch(`${NETFLIX_API_URL}/${jobId}`, {
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.http(res.status, res.statusText),
    };
  }

  const data = await res.json();

  return {
    jd: JSON.stringify(data),
    error: JD_FETCH_OK,
  };
}
