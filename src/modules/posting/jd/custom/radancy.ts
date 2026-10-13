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
 * Follow a Radancy job URL only when the redirect still names that job.
 * A hop to another origin's homepage drops the posting path, so the stored URL is gone.
 */
export function radancyJobUrlAfterRedirect(from: string, location: string): string | null {
  let next: URL;

  try {
    next = new URL(location, from);
  } catch {
    return null;
  }

  const nextId = getRadancyJobId(next);
  if (!nextId) return null;

  return next.toString();
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
