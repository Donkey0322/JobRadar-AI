import { getHostnameWithoutWww } from "@/utils/url";

/**
 * Career sites fronting a board already stored under another ATS, where the URL alone
 * cannot name that board (e.g. a Workday tenant and site). Their URLs join that company
 * instead of forming a `none` row. Sites whose URL does identify the board belong in
 * the classifier's host map instead, so their job keys match the board's.
 */
const careerSiteAliases: Record<string, string> = {
  "careers.bankofamerica.com": "workday:ghr-lateral-us",
  "careers.confluent.io": "ashby:confluent",
  "careers.dexcom.com": "workday:dexcom-dexcom",
  "careers.dovercorporation.com": "workday:dover-dover",
  "careers.homedepot.com": "workday:homedepot-careerdepot",
  "careers.intuitive.com": "smartrecruiters:intuitive",
  "careers.micron.com": "workday:micron-external",
  "careers.oracle.com": "oraclecloud:eeho.fa.us2.oraclecloud.com",
  "careers.peak6.com": "workday:peak6group-peak6",
  "careers.sig.com": "icims:sig",
  "careers.skyworksinc.com": "successfactors:careers.skyworksinc.com",
  "careers.thrivent.com": "workday:thrivent-external",
  "dowjones.jobs": "workday:dowjones-dow_jones_career",
  "drw.com": "greenhouse:drweng",
  "jobs.disneycareers.com": "radancy:disneycareers.com",
  "jobs.hilton.com": "oraclecloud:efet.fa.us2.oraclecloud.com",
  "jobs.johnsoncontrols.com": "workday:jci-jci",
  "jobs.lumen.com": "eightfold:lumen",
  "jobs.sick.com": "successfactors:jobs.sick.com",
  "mechanize.work": "ashby:mechanize",
  "retailcareers.staples.com": "radancy:retailcareers.staples.com",
  "sartorius.com": "workday:sartorius-sartoriuscareers",
  "uline.jobs": "workday:uline-uline_careers",
};

/** Company key of the board behind an unread career site, or null when it has none. */
export function aliasedCompanyKey(url: URL): string | null {
  return careerSiteAliases[getHostnameWithoutWww(url)] ?? null;
}
