import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

export async function fetchWorkdayJD(url: string, signal: AbortSignal): Promise<JDFetchResult> {
  const u = new URL(url);
  const name = u.hostname.split(".")[0];
  const parts = u.pathname.split("/").filter(Boolean);
  const isLocale = (str: string) => /^[a-z]{2}-[A-Z]{2}$/.test(str);
  const careerPage = (parts.find((p) => !isLocale(p)) || "").toLowerCase();

  const index = parts.findIndex((p) => p === "job");
  if (index === -1) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Workday URL") };
  }

  const endpoint = parts.slice(index + 1).join("/");
  const apiUrl = `${u.origin}/wday/cxs/${name}/${careerPage}/job/${endpoint}`;

  return fetchJD(apiUrl, signal, { logLabel: "workday JD" });
}
