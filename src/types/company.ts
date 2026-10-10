import type { ATS } from "@/modules/employer/type";

export interface Company {
  name: string;
  ats: ATS;
  identifier: string;
  domain: string;
  page: string;
  urls: string[];
}
