import { ABORT_SIGNAL } from "@/constants";
import { NETFLIX_API_URL } from "@/constants/ats";

import { JD_FETCH_ERROR, JD_FETCH_OK, type JDFetchResult } from "../fetch";

import { getLastPathNumber } from "@/modules/job-dedup/utils";

export async function fetchNetflixJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
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
