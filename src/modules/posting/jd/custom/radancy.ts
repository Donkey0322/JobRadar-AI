import { getRadancyJobId } from "@/modules/employer/shared/radancy";

const MAX_REDIRECTS = 5;

const DOCUMENT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (JD-Analyzer)",
  "Accept-Encoding": "identity",
} as const;

export interface RadancyJobDocument {
  response: Response;
  landedOnJob: boolean;
}

/**
 * Follow a Radancy job URL.
 * A move onto another origin's homepage keeps the job path, so a retired host
 * still resolves to the posting instead of the board's front page.
 */
export function radancyJobUrlAfterRedirect(from: string, location: string): string | null {
  let next: URL;

  try {
    next = new URL(location, from);
  } catch {
    return null;
  }

  const current = new URL(from);
  const currentId = getRadancyJobId(current);
  const nextId = getRadancyJobId(next);

  if (currentId && currentId === nextId) return next.toString();

  if (next.origin !== current.origin && currentId) {
    return `${next.origin}${current.pathname}${current.search}`;
  }

  if (nextId) return next.toString();
  return null;
}

export async function fetchRadancyJobDocument(
  url: string,
  signal: AbortSignal
): Promise<RadancyJobDocument> {
  const originalId = getRadancyJobId(new URL(url));
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: DOCUMENT_HEADERS,
    });

    const landedOnJob = originalId !== null && getRadancyJobId(new URL(current)) === originalId;

    if (response.status < 300 || response.status >= 400) {
      return { response, landedOnJob };
    }

    const location = response.headers.get("location");
    const next = location ? radancyJobUrlAfterRedirect(current, location) : null;
    if (!next || next === current || hop === MAX_REDIRECTS) {
      return { response, landedOnJob: false };
    }

    current = next;
  }

  return {
    response: new Response(null, { status: 404, statusText: "Not Found" }),
    landedOnJob: false,
  };
}
