export type ATS =
  | "greenhouse"
  | "lever"
  | "workday"
  | "ashby"
  | "oraclecloud"
  | "smartrecruiters"
  | "icims"
  | "custom";

export interface Company {
  name: string;
  ats: ATS;
  identifier: string;
  domain: string;
  page: string;
  urls: string[];
}
