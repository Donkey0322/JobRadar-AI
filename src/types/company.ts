import type { ATS } from "@/modules/ats/types";

export interface Company {
  name: string;
  ats: ATS;
  identifier: string;
  domain: string;
  page: string;
  urls: string[];
}
