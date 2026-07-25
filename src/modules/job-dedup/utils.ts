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
  const segments = pathname.split("/").filter(Boolean);

  for (let i = segments.length - 1; i >= 0; i--) {
    const match = segments[i].match(/^(\d+(?:-\d+)*)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}
