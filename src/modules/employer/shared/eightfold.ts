const domainMap: Record<string, string> = {
  "searchcareers.caci.com": "caci.com",
  "apply.careers.microsoft.com": "microsoft.com",
};

export function eightfoldDomain(url: URL, identifier = url.hostname.replace(".eightfold.ai", "")) {
  return url.searchParams.get("domain") ?? domainMap[url.hostname] ?? `${identifier}.com`;
}
