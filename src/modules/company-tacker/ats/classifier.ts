import type { ATS } from "../type";

const hostToATS: Record<string, ATS> = {
  "stripe.com": "greenhouse",
  "deere.com": "greenhouse",
};

export function classifyATS(url: URL): ATS {
  const host = url.hostname;

  if (hostToATS[host]) {
    return hostToATS[host];
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
  }

  if (url.searchParams.get("8fold_id")) return "eightfold";
  if (url.searchParams.get("ph_id")) return "phenom";
  if (url.searchParams.get("ashby_jid")) return "ashby";
  if (url.searchParams.get("gh_jid")) return "greenhouse";

  return "custom";
}
