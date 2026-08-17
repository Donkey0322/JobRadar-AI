import type { ATS } from "../type";
import type { ATSFetcher } from "./fetcher";

import { ashbyFetcher } from "../listing/ashby";
import { customFetcher } from "../listing/custom";
import { eightfoldFetcher } from "../listing/eightfold";
import { greenhouseFetcher } from "../listing/greenhouse";
import { icimsFetcher } from "../listing/icims";
import { leverFetcher } from "../listing/lever";
import { oracleCloudFetcher } from "../listing/oraclecloud";
import { phenomFetcher } from "../listing/phenom";
import { smartRecruitersFetcher } from "../listing/smart";
import { workdayFetcher } from "../listing/workday";

export const atsFetchers = {
  ashby: ashbyFetcher,
  eightfold: eightfoldFetcher,
  greenhouse: greenhouseFetcher,
  icims: icimsFetcher,
  lever: leverFetcher,
  oraclecloud: oracleCloudFetcher,
  phenom: phenomFetcher,
  smartrecruiters: smartRecruitersFetcher,
  workday: workdayFetcher,
  custom: customFetcher,
} satisfies Record<ATS, ATSFetcher<unknown>>;

export function getATSFetcher(ats: ATS): ATSFetcher<unknown> {
  return atsFetchers[ats];
}
