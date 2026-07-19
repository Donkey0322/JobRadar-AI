import { ABORT_SIGNAL } from "@/constants";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

import { isWorkdayLocaleSegment } from "@/modules/shared/ats/workday";

export async function fetchWorkdayJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const u = new URL(url);
  const name = u.hostname.split(".")[0];
  const parts = u.pathname.split("/").filter(Boolean);
  const careerPage = (parts.find((p) => !isWorkdayLocaleSegment(p, "strict")) || "").toLowerCase();

  const index = parts.findIndex((p) => p === "job");
  if (index === -1) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Workday URL") };
  }

  const endpoint = parts.slice(index + 1).join("/");
  const apiUrl = `${u.origin}/wday/cxs/${name}/${careerPage}/job/${endpoint}`;

  return fetchJD(apiUrl, signal, { logLabel: "workday JD" });
}
