import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";
import { createJDFetchSignal } from "./signal";

import {
  getPinpointPostingId,
  getPinpointSlug,
  isPinpointHost,
  pinpointListingUrl,
  PinpointResponseSchema,
} from "@/modules/ats/pinpoint";
import { htmlToText } from "@/utils/html";

/** Pinpoint has no per-posting API; the JD comes from the tenant's postings feed. */
export async function fetchPinpointJD(
  url: string,
  signal: AbortSignal = createJDFetchSignal()
): Promise<JDFetchResult> {
  const u = new URL(url);
  const id = getPinpointPostingId(u.pathname);

  if (!isPinpointHost(u) || !id) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Pinpoint URL") };
  }

  return fetchJD(pinpointListingUrl(getPinpointSlug(u)), signal, {
    logLabel: "Pinpoint JD",
    transform: (data) => {
      const parsed = PinpointResponseSchema.safeParse(data);
      const posting = parsed.data?.data.find((job) => getPinpointPostingId(job.path) === id);
      if (!posting) return null;

      return [
        posting.description,
        posting.key_responsibilities,
        posting.skills_knowledge_expertise,
        posting.benefits,
      ]
        .filter((html): html is string => Boolean(html))
        .map(htmlToText)
        .join("\n");
    },
  });
}
