const domainMap: Record<string, string> = {
  "searchcareers.caci.com": "caci.com",
  "apply.careers.microsoft.com": "microsoft.com",
  "join.sephora.com": "sephora.com",
  "jobs.ericsson.com": "ericsson.com",
  "career.mlp.com": "mlp.com",
  "careers.zebra.com": "zebra.com",
  "careers.qualcomm.com": "qualcomm.com",
  "careers.lumen.com": "lumen.com",
  "careers.newyorklife.com": "newyorklife.com",
};

/** Custom career hosts that front a tenant already stored under its *.eightfold.ai slug. */
const tenantMap: Record<string, string> = {
  "career.mlp.com": "mlp",
  "careers.lumen.com": "lumen",
  "careers.newyorklife.com": "newyorklife",
  "careers.qualcomm.com": "qualcomm",
  "careers.zebra.com": "zebra",
};

export function eightfoldIdentifier(url: URL): string {
  return tenantMap[url.hostname] ?? url.hostname.replace(".eightfold.ai", "");
}

export function eightfoldDomain(url: URL, identifier = eightfoldIdentifier(url)) {
  return url.searchParams.get("domain") ?? domainMap[url.hostname] ?? `${identifier}.com`;
}
