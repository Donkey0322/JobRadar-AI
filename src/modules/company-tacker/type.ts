export interface Company {
  name: string;
  ats: "greenhouse" | "lever" | "workday" | "ashby" | "custom";
  identifier: string;
  domain: string;
  page: string;
  urls: string[];
}
