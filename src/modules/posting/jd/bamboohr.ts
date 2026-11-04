import { createJDFetchSignal } from "@/constants";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

import {
  bambooHRDetailUrl,
  getBambooHRJobId,
  getBambooHRSlug,
  isBambooHRHost,
} from "@/modules/ats/bamboohr";

export async function fetchBambooHRJD(
  url: string,
  signal: AbortSignal = createJDFetchSignal()
): Promise<JDFetchResult> {
  const u = new URL(url);
  const id = getBambooHRJobId(u.pathname);

  if (!isBambooHRHost(u) || !id) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid BambooHR URL") };
  }

  return fetchJD(bambooHRDetailUrl(getBambooHRSlug(u), id), signal, {
    logLabel: "BambooHR JD",
  });
}
