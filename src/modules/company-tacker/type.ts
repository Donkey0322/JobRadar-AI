export type ATS =
  | "ashby"
  | "eightfold"
  | "greenhouse"
  | "icims"
  | "lever"
  | "oraclecloud"
  | "phenom"
  | "smartrecruiters"
  | "workday"
  | "custom";

export interface Company {
  name: string;
  ats: ATS;
  identifier: string;
  domain: string;
  page: string;
  urls: string[];
}
