export type CustomCompanyIdentifier =
  | "amazon"
  | "google"
  | "meta"
  | "apple"
  | "netflix"
  | "tiktok"
  | "amd";

export const CUSTOM_COMPANY_DOMAINS = {
  amazon: "amazon.jobs",
  google: "google.com",
  meta: "metacareers.com",
  apple: "jobs.apple.com",
  netflix: "netflix.net",
  tiktok: "tiktok.com",
  amd: "amd.com",
} satisfies Record<CustomCompanyIdentifier, string>;

export function parseCustomCompanyIdentifier(url: URL): CustomCompanyIdentifier | null {
  const host = url.hostname;

  for (const [identifier, domain] of Object.entries(CUSTOM_COMPANY_DOMAINS)) {
    if (host.endsWith(domain)) {
      return identifier as CustomCompanyIdentifier;
    }
  }

  return null;
}
