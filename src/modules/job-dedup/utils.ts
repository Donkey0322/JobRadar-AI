import { removeTrailingSlash } from "@/utils/url";

export function normalizeUrl(url: string): string {
  const u = new URL(url);

  u.protocol = "https:";
  u.hash = "";
  u.search = "";
  u.pathname = removeTrailingSlash(u.pathname);

  return u.toString();
}

export function getLastPathNumber(pathname: string): string | null {
  const matches = [...pathname.matchAll(/\/(\d+)/g)];

  return matches.at(-1)?.[1] ?? null;
}
