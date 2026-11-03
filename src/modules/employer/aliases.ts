import { getHostnameWithoutWww } from "@/utils/url";

/**
 * Career sites fronting a board already stored under another ATS, where the URL alone
 * cannot name that board (e.g. a Workday tenant and site). Their URLs join that company
 * instead of forming a custom row. Sites whose URL does identify the board belong in
 * the classifier's host map instead, so their job keys match the board's.
 */
const careerSiteAliases: Record<string, string> = {
  "careers.confluent.io": "ashby:confluent",
  "careers.homedepot.com": "workday:homedepot-careerdepot",
  "careers.intuitive.com": "smartrecruiters:intuitive",
  "careers.oracle.com": "oraclecloud:eeho.fa.us2.oraclecloud.com",
  "careers.thrivent.com": "workday:thrivent-external",
  "dowjones.jobs": "workday:dowjones-dow_jones_career",
  "jobs.disneycareers.com": "radancy:disneycareers.com",
  "jobs.hilton.com": "oraclecloud:efet.fa.us2.oraclecloud.com",
  "retailcareers.staples.com": "radancy:retailcareers.staples.com",
  "sartorius.com": "workday:sartorius-sartoriuscareers",
  "uline.jobs": "workday:uline-uline_careers",
};

/** Company key of the board behind a custom career site, or null when it has none. */
export function aliasedCompanyKey(url: URL): string | null {
  return careerSiteAliases[getHostnameWithoutWww(url)] ?? null;
}
