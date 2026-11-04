import { aliasedCompanyKey } from "./aliases";
import { employers } from "./registry";

import { classifyATS } from "@/modules/ats/classify";

/** Company key of the ATS row an unread career-site URL belongs to, if it is aliased. */
export function careerSiteAlias(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    return classifyATS(url) === "none" ? aliasedCompanyKey(url) : null;
  } catch {
    return null;
  }
}

/** Company key for a URL; an aliased career site joins the board it fronts. */
export function companyKeyFromUrl(url: URL): string {
  return careerSiteAlias(url.href) ?? employers[classifyATS(url)].companyKeyFromUrl(url);
}
