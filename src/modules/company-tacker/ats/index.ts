import type { ATS } from "../type";

export * from "./greenhouse";
export * from "./lever";
export * from "./workday";
export * from "./ashby";
export * from "./oraclecloud";
export * from "./smart";
export * from "./icims";
export * from "./custom";

const hostToATS: Record<string, ATS> = {
  "stripe.com": "greenhouse",
};

export function classifyATS(url: URL): ATS {
  const host = url.hostname;

  if (url.searchParams.get("gh_jid")) return "greenhouse";

  if (host.endsWith("greenhouse.io")) {
    return "greenhouse";
  } else if (host.endsWith("lever.co")) {
    return "lever";
  } else if (host.endsWith("workdayjobs.com")) {
    return "workday";
  } else if (host.endsWith("ashbyhq.com")) {
    return "ashby";
  } else if (host.endsWith("oraclecloud.com")) {
    return "oraclecloud";
  } else if (host.endsWith("smartrecruiters.com")) {
    return "smartrecruiters";
  } else if (host.endsWith("icims.com")) {
    return "icims";
  } else {
    return hostToATS[host] ?? "custom";
  }
}
