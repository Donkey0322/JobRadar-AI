import type { ATS } from "../type";
import type { ATSFetcher } from "./class";

import { ashbyFetcher } from "./ashby";
import { customFetcher } from "./custom";
import { eightfoldFetcher } from "./eightfold";
import { greenhouseFetcher } from "./greenhouse";
import { icimsFetcher } from "./icims";
import { leverFetcher } from "./lever";
import { oracleCloudFetcher } from "./oraclecloud";
import { phenomFetcher } from "./phenom";
import { smartRecruitersFetcher } from "./smart";
import { workdayFetcher } from "./workday";

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
