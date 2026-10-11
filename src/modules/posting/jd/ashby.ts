import { ASHBY_API_URL } from "@/constants/ats";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

import { resolveAshbyIdentifier } from "@/modules/employer/shared/ashby";
import { getAshbyJobId } from "@/utils/job-key/ats";

export async function fetchAshbyJD(url: string, signal: AbortSignal): Promise<JDFetchResult> {
  const u = new URL(url);
  const identifier = await resolveAshbyIdentifier(u);
  const id = getAshbyJobId(u);

  if (!identifier || !id) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Ashby URL") };
  }

  const apiUrl = `${ASHBY_API_URL}/${identifier}`;

  return fetchJD(apiUrl, signal, {
    logLabel: "ashby JD",
    transform: (data) => {
      const jobs = (data as { jobs?: Array<{ id: string }> })?.jobs;
      const jd = jobs?.find((job) => job.id.toLowerCase() === id.toLowerCase());
      return jd ? JSON.stringify(jd) : null;
    },
  });
}
