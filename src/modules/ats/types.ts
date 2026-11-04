export type ATS =
  | "ashby"
  | "bamboohr"
  | "eightfold"
  | "greenhouse"
  | "icims"
  | "jazzhr"
  | "lever"
  | "oraclecloud"
  | "phenom"
  | "pinpoint"
  | "radancy"
  | "rippling"
  | "smartrecruiters"
  | "successfactors"
  | "workday"
  /** A career site with its own fetcher in `listing/custom`. */
  | "custom"
  /** A career site no fetcher reads yet. */
  | "none";
