export function stripTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function normalizeUrl(url: string): string {
  const u = new URL(url);

  u.protocol = "https:";
  u.hash = "";
  u.search = "";
  u.pathname = stripTrailingSlash(u.pathname);

  return u.toString();
}

export function getLastPathNumber(pathname: string): string | null {
  const match = pathname.match(/\/(\d{6,})(?:\/|$)/);
  return match?.[1] ?? null;
}
