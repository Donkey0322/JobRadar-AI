import { ASHBY_API_URL } from "@/constants/ats";

import type { AshbyJob } from "@/modules/company-tacker/ats/ashby";

import { fetchJD, JD_FETCH_ERROR, type JDFetchResult } from "./fetch";

export async function fetchAshbyJD(url: string, signal: AbortSignal): Promise<JDFetchResult> {
  const u = new URL(url);
  const identifier = u.pathname.split("/")[1];
  const id = u.pathname.split("/")[2];

  if (!identifier || !id) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Ashby URL") };
  }

  const apiUrl = `${ASHBY_API_URL}/${identifier}`;

  return fetchJD(apiUrl, signal, {
    logLabel: "ashby JD",
    transform: (data) => {
      const jobs = (data as { jobs?: AshbyJob[] })?.jobs;
      const jd = jobs?.find((job) => job.id === id);
      return jd ? JSON.stringify(jd) : null;
    },
  });
}
