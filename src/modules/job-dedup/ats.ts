import { parseCustomCompanyIdentifier } from "../company-tacker/ats/custom/identifier";

import { getLastPathNumber } from "./utils";

function toATSKey(vendor: string, id: string | null | undefined): string | null {
  return id ? `${vendor}:${id}` : null;
}

function getPathSegmentKey(url: URL, vendor: string, index: number): string | null {
  const id = url.pathname.split("/")[index];
  return toATSKey(vendor, id?.toLowerCase());
}

function getNumericRouteKey(pathname: string, vendor: string, route: string): string | null {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = pathname.match(new RegExp(`/${escapedRoute}/(\\d+)(?:/|$)`, "i"));
  return toATSKey(vendor, match?.[1]);
}

export function getGreenhouseKey(u: URL): string | null {
  const gh = u.searchParams.get("gh_jid");
  if (gh) return toATSKey("greenhouse", gh);

  const id = getLastPathNumber(u.pathname);
  if (id) return toATSKey("greenhouse", id);

  const token = u.searchParams.get("token");
  if (token) return toATSKey("greenhouse", token);

  return null;
}

export function getWorkdayKey(url: string): string | null {
  const match = url.match(/_([^/_?]+)(?:\?|$)/);
  if (!match) return null;

  const id = match[1].replace(/-[0-9]$/, "");
  const tenant = getWorkdayTenant(url);

  // Reqition IDs are only unique within a Workday tenant, not globally.
  return toATSKey("workday", tenant ? `${tenant}:${id}` : id);
}

function getWorkdayTenant(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();

    if (host.endsWith("myworkdaysite.com")) {
      const parts = pathname.split("/").filter(Boolean);
      const recruitingIndex = parts.findIndex((part) => part.toLowerCase() === "recruiting");
      return parts[recruitingIndex + 1]?.toLowerCase() ?? null;
    }

    // premera.wd5.myworkdayjobs.com → premera
    const tenant = host.split(".")[0];
    return tenant || null;
  } catch {
    return null;
  }
}

export function getAshbyKey(url: URL): string | null {
  return getPathSegmentKey(url, "ashby", 2);
}

export function getLeverKey(url: URL): string | null {
  return getPathSegmentKey(url, "lever", 2);
}

export function getSmartRecruitersKey(pathname: string): string | null {
  const id = getLastPathNumber(pathname);
  return toATSKey("smartrecruiters", id);
}

export function getOracleKey(pathname: string): string | null {
  return getNumericRouteKey(pathname, "oraclecloud", "job");
}

export function getEightfoldKey(url: URL): string | null {
  const pathKey = getNumericRouteKey(url.pathname, "eightfold", "job");
  if (pathKey) return pathKey;

  const id = url.searchParams.get("8fold_id") ?? url.searchParams.get("pid");
  return toATSKey("eightfold", id);
}

export function getPhenomKey(pathname: string): string | null {
  return getNumericRouteKey(pathname, "phenom", "job");
}

export function getIcimsKey(pathname: string): string | null {
  return getNumericRouteKey(pathname, "icims", "jobs");
}

export function getCustomKey(url: string): string {
  const u = new URL(url);

  const identifier = parseCustomCompanyIdentifier(u);
  if (identifier) {
    const id = getLastPathNumber(u.pathname);
    if (id) return `${identifier}:${id}`;
    return `${identifier}:${u.origin}${u.pathname}`;
  }

  // ✅ case 1: Salesforce / bambusdev
  const jobReq = u.searchParams.get("jobReq");
  if (jobReq) {
    const match = jobReq.match(/REQ[-_]?\d+/i);
    if (match) return `custom:${match[0]}`;
  }

  // ✅ case 2: generic numeric in query
  for (const [, value] of u.searchParams.entries()) {
    const num = value.match(/\d{4,}/);
    if (num) return `custom:${num[0]}`;
  }

  // ✅ fallback: keep query to avoid merging
  return `custom:${u.origin}${u.pathname}?${u.searchParams.toString()}`;
}
