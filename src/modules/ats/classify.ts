import type { ATS } from "./types";

import { isBambooHRHost } from "./bamboohr";
import { parseCustomCompanyIdentifier } from "./custom";
import { isJazzHRUrl } from "./jazzhr";
import { isJibeUrl } from "./jibe";
import { isPinpointHost } from "./pinpoint";
import { isRadancyUrl } from "./radancy";
import { isRipplingHost } from "./rippling";
import { isSuccessFactorsUrl } from "./successfactors";

import { getHostnameWithoutWww } from "@/utils/url";

const hostToATS: Record<string, ATS> = {
  "stripe.com": "greenhouse",
  "deere.com": "greenhouse",
  "hudsonrivertrading.com": "greenhouse",
  "careers.duolingo.com": "greenhouse",
  "careers.nintendo.com": "greenhouse",
  "careers.roblox.com": "greenhouse",
  "databricks.com": "greenhouse",
  "epicgames.com": "greenhouse",
  "imc.com": "greenhouse",
  "janestreet.com": "greenhouse",
  "mongodb.com": "greenhouse",
  "optiver.com": "greenhouse",
  "pinterestcareers.com": "greenhouse",
  "riotgames.com": "greenhouse",
  "samsara.com": "greenhouse",
  "squarepoint-capital.com": "greenhouse",
  "xantium.com": "greenhouse",
  "apply.careers.microsoft.com": "eightfold",
  "career.mlp.com": "eightfold",
  "careers.lumen.com": "eightfold",
  "careers.newyorklife.com": "eightfold",
  "careers.qualcomm.com": "eightfold",
  "careers.zebra.com": "eightfold",
  "jobs.ericsson.com": "eightfold",
  "join.sephora.com": "eightfold",
  "careers.bcg.com": "phenom",
  "careers.cisco.com": "phenom",
  "careers.hellofresh.com": "phenom",
  "careers.itw.com": "phenom",
  "careers.tranetechnologies.com": "phenom",
  "careers.varsitybrands.com": "phenom",
  "careers.zimmerbiomet.com": "phenom",
  "jobs.ascension.org": "phenom",
  "careers.skyworksinc.com": "successfactors",
  "careers.zurich.com": "successfactors",
  "jobs.bmwgroup.com": "successfactors",
  "jobs.sick.com": "successfactors",
};

export function classifyATS(url: URL): ATS {
  const host = url.hostname;

  // end with a known ATS
  const listedHost = hostToATS[host] ?? hostToATS[getHostnameWithoutWww(url)];
  if (listedHost) {
    return listedHost;
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
  } else if (isRipplingHost(url)) {
    return "rippling";
  } else if (isBambooHRHost(url)) {
    return "bamboohr";
  } else if (isPinpointHost(url)) {
    return "pinpoint";
  }

  if (url.searchParams.get("8fold_id")) return "eightfold";
  if (url.searchParams.get("ph_id")) return "phenom";
  if (url.searchParams.get("ashby_jid")) return "ashby";
  if (url.searchParams.get("gh_jid")) return "greenhouse";
  if (isRadancyUrl(url)) return "radancy";
  if (isSuccessFactorsUrl(url)) return "successfactors";
  if (isJazzHRUrl(url)) return "jazzhr";
  if (isJibeUrl(url)) return "icims";

  return parseCustomCompanyIdentifier(url) ? "custom" : "none";
}
