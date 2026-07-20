import type { ATS } from "../type";

import { TRACKING_PARAM as EIGHTFOLD_TRACKING_PARAM } from "./eightfold";
import { TRACKING_PARAM as PHENOM_TRACKING_PARAM } from "./phenom";

export * from "./class";
export * from "./registry";
export {
  AshbyFetcher,
  ashbyFetcher,
  AshbyJobSchema,
  AshbyResponseSchema,
  type AshbyJob,
} from "./ashby";
export {
  CustomFetcher,
  customFetcher,
  CUSTOM_COMPANY_DOMAINS,
  parseCustomCompanyIdentifier,
} from "./custom";
export {
  EightfoldApplyJobSchema,
  EightfoldApplyResponseSchema,
  EightfoldFetcher,
  eightfoldFetcher,
  EightfoldJobSchema,
  EightfoldPcsxResponseSchema,
  TRACKING_PARAM as EIGHTFOLD_TRACKING_PARAM,
  type EightfoldJob,
} from "./eightfold";
export {
  GreenhouseFetcher,
  greenhouseFetcher,
  GreenhouseJobSchema,
  GreenhouseResponseSchema,
  type GreenhouseJob,
} from "./greenhouse";
export { IcimsFetcher, icimsFetcher, IcimsJobSchema, type IcimsJob } from "./icims";
export {
  LeverFetcher,
  leverFetcher,
  LeverJobSchema,
  LeverResponseSchema,
  type LeverJob,
} from "./lever";
export {
  OracleCloudFetcher,
  oracleCloudFetcher,
  OracleCloudJobSchema,
  OracleCloudResponseSchema,
  type OracleCloudJob,
} from "./oraclecloud";
export {
  PhenomFetcher,
  phenomFetcher,
  PhenomJobSchema,
  TRACKING_PARAM as PHENOM_TRACKING_PARAM,
  type PhenomJob,
} from "./phenom";
export {
  SmartRecruitersFetcher,
  smartRecruitersFetcher,
  SmartRecruitersJobSchema,
  SmartRecruitersResponseSchema,
  type SmartRecruitersJob,
} from "./smart";
export {
  WorkdayFetcher,
  workdayFetcher,
  WorkdayJobSchema,
  type WorkdayJob,
} from "./workday";

const hostToATS: Record<string, ATS> = {
  "stripe.com": "greenhouse",
  "deere.com": "greenhouse",
};

export function classifyATS(url: URL): ATS {
  const host = url.hostname;

  if (hostToATS[host]) {
    return hostToATS[host];
  }

  if (host.endsWith("greenhouse.io")) {
    return "greenhouse";
  } else if (host.endsWith("lever.co")) {
    return "lever";
  } else if (host.endsWith("workdayjobs.com") || host.endsWith("myworkdaysite.com")) {
    return "workday";
  } else if (host.endsWith("ashbyhq.com")) {
    return "ashby";
  } else if (host.endsWith("oraclecloud.com")) {
    return "oraclecloud";
  } else if (host.endsWith("smartrecruiters.com")) {
    return "smartrecruiters";
  } else if (host.endsWith("icims.com")) {
    return "icims";
  } else if (host.endsWith("eightfold.ai")) {
    return "eightfold";
  } else {
    if (url.searchParams.get(EIGHTFOLD_TRACKING_PARAM)) return "eightfold";
    if (url.searchParams.get(PHENOM_TRACKING_PARAM)) return "phenom";
    if (url.searchParams.get("ashby_jid")) return "ashby";
    if (url.searchParams.get("gh_jid")) return "greenhouse";

    return "custom";
  }
}
