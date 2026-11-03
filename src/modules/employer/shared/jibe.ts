import z from "zod";

import { stripLegalSuffix } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

/**
 * iCIMS Attract (Jibe) career sites front an iCIMS ATS with a JSON listing API
 * at `/api/jobs`. One Jibe site can span several iCIMS portals.
 */
const JIBE_API_PATH = "/api/jobs";

export const JIBE_PAGE_SIZE = 100;

const JibeJobSchema = z.object({
  req_id: z.string(),
  title: z.string(),
  apply_url: z.string().optional(),
  full_location: z.string().optional(),
  short_location: z.string().optional(),
  location_name: z.string().optional(),
  posted_date: z.string().optional(),
  hiring_organization: z.string().optional(),
});

export type JibeJob = z.infer<typeof JibeJobSchema>;

const JibeResponseSchema = z.object({
  jobs: z.array(z.object({ data: JibeJobSchema })),
});

/** Jibe sites whose job links show up without `?icims=1`. */
const JIBE_HOSTS = new Set([
  "careers.akima.com",
  "careers.amd.com",
  "careers.arcfield.com",
  "careers.jhuapl.edu",
]);

/** Names that differ from the site's `hiring_organization`. */
const COMPANY_NAMES: Record<string, string> = {
  "careers.amd.com": "AMD",
};

export function jibeCompanyName(hiringOrganization: string | null, url: URL): string | null {
  const override = COMPANY_NAMES[getHostnameWithoutWww(url)];
  if (override) return override;
  return hiringOrganization ? stripLegalSuffix(hiringOrganization) : null;
}

export function isJibeUrl(url: URL): boolean {
  return (
    url.hostname.endsWith(".jibeapply.com") ||
    url.searchParams.get("icims") === "1" ||
    JIBE_HOSTS.has(getHostnameWithoutWww(url))
  );
}

export function isJibeApiUrl(url: URL): boolean {
  return url.pathname === JIBE_API_PATH;
}

export function getJibeApiUrl(origin: string, page = 1, limit = JIBE_PAGE_SIZE): string {
  const url = new URL(JIBE_API_PATH, origin);

  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sortBy", "posted_date");
  url.searchParams.set("descending", "true");
  url.searchParams.set("internal", "false");

  return url.toString();
}

/** Jobs from an `/api/jobs` response, or null when the payload is not Jibe. */
export function parseJibeJobs(data: unknown): JibeJob[] | null {
  const parsed = JibeResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.jobs.map((item) => item.data) : null;
}

/** Retired iCIMS portals replace the job list with `location.href = '<jibe site>'`. */
export function findJibeRedirect(html: string, baseUrl: URL): URL | null {
  const match = html.match(/location\.href\s*=\s*'([^']+)'/);
  if (!match?.[1]) return null;

  try {
    const target = new URL(match[1].replace(/\\\//g, "/"), baseUrl);
    return target.hostname === baseUrl.hostname ? null : target;
  } catch {
    return null;
  }
}

function isIcimsBacked(job: JibeJob): boolean {
  if (!job.apply_url) return false;

  try {
    return new URL(job.apply_url).hostname.endsWith(".icims.com");
  } catch {
    return false;
  }
}

/**
 * Job page on the Jibe site, e.g. `https://careers.acme.com/jobs/123?icims=1`,
 * the form job boards link to. Null when the job is not backed by iCIMS.
 */
export function getJibeJobLink(origin: string, job: JibeJob): string | null {
  if (!isIcimsBacked(job)) return null;

  const url = new URL(`/jobs/${encodeURIComponent(job.req_id)}`, origin);
  url.searchParams.set("icims", "1");

  return url.toString();
}

export function getJibeLocation(job: JibeJob): string {
  return job.full_location ?? job.short_location ?? job.location_name ?? "Unsure";
}
