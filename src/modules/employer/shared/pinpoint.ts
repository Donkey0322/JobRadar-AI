import z from "zod";

const PINPOINT_DOMAIN = ".pinpointhq.com";
const NON_TENANT_HOSTS = new Set(["www", "api", "app", "help", "developers"]);
const POSTING_PATH = /\/postings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const SITE_TITLE = /<title>\s*Jobs at (.+?)\s*\|/i;

export const PinpointPostingSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  path: z.string(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  workplace_type: z.string().nullish(),
  description: z.string().nullish(),
  key_responsibilities: z.string().nullish(),
  skills_knowledge_expertise: z.string().nullish(),
  benefits: z.string().nullish(),
});

export const PinpointResponseSchema = z.object({
  data: z.array(PinpointPostingSchema),
});

export type PinpointPosting = z.infer<typeof PinpointPostingSchema>;

export function isPinpointHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(PINPOINT_DOMAIN)) return false;

  const tenant = host.slice(0, -PINPOINT_DOMAIN.length);
  return Boolean(tenant) && !tenant.includes(".") && !NON_TENANT_HOSTS.has(tenant);
}

/** `idtus.pinpointhq.com` → `idtus`. */
export function getPinpointSlug(url: URL): string {
  return url.hostname.toLowerCase().split(".")[0];
}

/** Posting UUIDs are unique across every Pinpoint tenant. */
export function getPinpointPostingId(pathname: string): string | null {
  return pathname.match(POSTING_PATH)?.[1]?.toLowerCase() ?? null;
}

function tenantOrigin(slug: string): string {
  return `https://${slug}${PINPOINT_DOMAIN}`;
}

export function pinpointListingUrl(slug: string): string {
  return `${tenantOrigin(slug)}/postings.json`;
}

/** Tenant-host link; the API `url` may point at a custom careers domain instead. */
export function pinpointJobUrl(slug: string, path: string): string {
  return new URL(path, tenantOrigin(slug)).toString();
}

export function parsePinpointCompanyName(html: string): string | null {
  return html.match(SITE_TITLE)?.[1]?.trim() || null;
}

export async function fetchPinpointCompanyName(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${tenantOrigin(slug)}/`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return parsePinpointCompanyName(await res.text());
  } catch {
    return null;
  }
}
