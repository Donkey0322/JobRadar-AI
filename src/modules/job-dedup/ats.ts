import { parseCustomCompanyIdentifier } from "../company-tacker/ats";

import { getLastPathNumber } from "./utils";

export function getGreenhouseKey(u: URL): string | null {
  const gh = u.searchParams.get("gh_jid");
  if (gh) return `greenhouse:${gh}`;

  const id = getLastPathNumber(u.pathname);
  if (id) return `greenhouse:${id}`;

  const token = u.searchParams.get("token");
  if (token) return `greenhouse:${token}`;

  return null;
}

export function getWorkdayKey(url: string): string | null {
  const match = url.match(/_([^/_?]+)(?:\?|$)/);
  if (!match) return null;

  let id = match[1];

  id = id.replace(/-[0-9]$/, "");
  return `workday:${id}`;
}

export function getAshbyKey(url: URL): string | null {
  const pathname = url.pathname;
  const id = pathname.split("/")[2];
  return id ? `ashby:${id.toLowerCase()}` : null;
}

export function getLeverKey(url: URL): string | null {
  const pathname = url.pathname;
  const id = pathname.split("/")[2];
  return id ? `lever:${id.toLowerCase()}` : null;
}

export function getSmartRecruitersKey(pathname: string): string | null {
  const id = getLastPathNumber(pathname);
  return id ? `smartrecruiters:${id}` : null;
}

export function getOracleKey(pathname: string): string | null {
  const match = pathname.match(/\/job\/(\d+)(?:\/|$)/i);
  return match ? `oraclecloud:${match[1]}` : null;
}

export function getIcimsKey(pathname: string): string | null {
  const match = pathname.match(/\/jobs\/(\d+)(?:\/|$)/i);
  return match ? `icims:${match[1]}` : null;
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
