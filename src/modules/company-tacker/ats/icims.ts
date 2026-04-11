import type { Company } from "../type";

export function urlToIcimsCompany(url: URL): Company {
  const host = url.hostname;

  const match = host.match(/-([^-]+)\.icims\.com$/);
  const result = match?.[1] ?? "";

  return {
    name: result,
    ats: "icims",
    identifier: result,
    domain: url.origin,
    page: `https://api.icims.com/v1/companies/${result}/jobs`,
    urls: [],
  };
}
