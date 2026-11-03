import type { Employer } from "./employer";
import type { ATS } from "./type";
import type { Company } from "@/types";

import { ashbyFetcher } from "./listing/ashby";
import { customFetcher } from "./listing/custom";
import { eightfoldFetcher } from "./listing/eightfold";
import { greenhouseFetcher } from "./listing/greenhouse";
import { icimsFetcher } from "./listing/icims";
import { leverFetcher } from "./listing/lever";
import { oracleCloudFetcher } from "./listing/oraclecloud";
import { phenomFetcher } from "./listing/phenom";
import { radancyFetcher } from "./listing/radancy";
import { ripplingFetcher } from "./listing/rippling";
import { smartRecruitersFetcher } from "./listing/smart";
import { successFactorsFetcher } from "./listing/successfactors";
import { workdayFetcher } from "./listing/workday";

export const employers = {
  ashby: ashbyFetcher,
  eightfold: eightfoldFetcher,
  greenhouse: greenhouseFetcher,
  icims: icimsFetcher,
  lever: leverFetcher,
  oraclecloud: oracleCloudFetcher,
  phenom: phenomFetcher,
  radancy: radancyFetcher,
  rippling: ripplingFetcher,
  smartrecruiters: smartRecruitersFetcher,
  successfactors: successFactorsFetcher,
  workday: workdayFetcher,
  custom: customFetcher,
} satisfies Record<ATS, Employer<unknown>>;

export function asEmployer(company: Company): Employer {
  const Board = employers[company.ats].constructor as new (company?: Company) => Employer;
  return new Board(company);
}
