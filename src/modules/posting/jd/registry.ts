import type { JDFetchResult } from "./fetch";
import type { ATS } from "@/modules/employer/type";

import { fetchAshbyJD } from "./ashby";
import { fetchCustomJD } from "./custom";
import { fetchEightfoldJD } from "./eightfold";
import { fetchGreenhouseJD } from "./greenhouse";
import { fetchIcimsJD } from "./icims";
import { fetchOracleJD } from "./oraclecloud";
import { fetchSmartRecruitersJD } from "./smart";
import { fetchWorkdayJD } from "./workday";

export type PostingJDFetcher = (url: string, signal: AbortSignal) => Promise<JDFetchResult>;

export const postingJDFetchers = {
  ashby: fetchAshbyJD,
  eightfold: fetchEightfoldJD,
  greenhouse: fetchGreenhouseJD,
  icims: fetchIcimsJD,
  oraclecloud: fetchOracleJD,
  smartrecruiters: fetchSmartRecruitersJD,
  workday: fetchWorkdayJD,

  lever: fetchCustomJD,
  phenom: fetchCustomJD,
  radancy: fetchCustomJD,
  custom: fetchCustomJD,
} satisfies Record<ATS, PostingJDFetcher>;

export function fetchJDByATS(
  ats: ATS,
  url: string,
  signal: AbortSignal
): Promise<JDFetchResult> {
  return postingJDFetchers[ats](url, signal);
}
