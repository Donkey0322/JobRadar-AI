import z from "zod";

const BAMBOOHR_DOMAIN = ".bamboohr.com";
const NON_TENANT_HOSTS = new Set(["www", "api", "app", "help", "marketplace"]);
const JOB_PATH = /^\/careers\/(\d+)(?:\/(?:detail)?)?\/?$/;
const SITE_NAME = /<meta[^>]+property="og:site_name"[^>]+content="([^"]*)"/i;

const PAGE_HEADERS: HeadersInit = {
  "user-agent": "Mozilla/5.0 (JobRadar)",
};

const DetailSchema = z.object({
  result: z.object({
    jobOpening: z.object({ datePosted: z.string().nullish() }),
  }),
});

export function isBambooHRHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(BAMBOOHR_DOMAIN)) return false;

  const tenant = host.slice(0, -BAMBOOHR_DOMAIN.length);
  return Boolean(tenant) && !tenant.includes(".") && !NON_TENANT_HOSTS.has(tenant);
}

/** `mujin.bamboohr.com` → `mujin`. */
export function getBambooHRSlug(url: URL): string {
  return url.hostname.toLowerCase().split(".")[0];
}

export function getBambooHRJobId(pathname: string): string | null {
  return pathname.match(JOB_PATH)?.[1] ?? null;
}

function tenantOrigin(slug: string): string {
  return `https://${slug}${BAMBOOHR_DOMAIN}`;
}

export function bambooHRListingUrl(slug: string): string {
  return `${tenantOrigin(slug)}/careers/list`;
}

export function bambooHRJobUrl(slug: string, id: string): string {
  return `${tenantOrigin(slug)}/careers/${id}`;
}

export function bambooHRDetailUrl(slug: string, id: string): string {
  return `${tenantOrigin(slug)}/careers/${id}/detail`;
}

/** Unknown tenants redirect to the bamboohr.com marketing site. */
export function isBambooHRTenantResponse(res: Response): boolean {
  if (!res.url) return true;
  return isBambooHRHost(new URL(res.url));
}

export function parseBambooHRSiteName(html: string): string | null {
  return html.match(SITE_NAME)?.[1]?.trim() || null;
}

export async function fetchBambooHRCompanyName(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${tenantOrigin(slug)}/careers`, {
      signal: AbortSignal.timeout(15_000),
      headers: PAGE_HEADERS,
    });
    if (!res.ok || !isBambooHRTenantResponse(res)) return null;
    return parseBambooHRSiteName(await res.text());
  } catch {
    return null;
  }
}

export async function fetchBambooHRDatePosted(
  slug: string,
  id: string,
  signal: AbortSignal
): Promise<string | null> {
  try {
    const res = await fetch(bambooHRDetailUrl(slug, id), {
      signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;

    const parsed = DetailSchema.safeParse(await res.json());
    return parsed.success ? (parsed.data.result.jobOpening.datePosted ?? null) : null;
  } catch {
    return null;
  }
}
