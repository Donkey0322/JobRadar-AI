import { ABORT_SIGNAL } from "@/constants";

import type { JDFetchResult } from "./fetch";

import { fetchJD } from "./fetch";

import { eightfoldDomain } from "@/modules/employer/shared/eightfold";
import { getLastPathNumber } from "@/utils/job-key/url";

export async function fetchEightfoldJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const u = new URL(url);
  const domain = eightfoldDomain(u);
  const id = u.searchParams.get("pid") ?? getLastPathNumber(url);
  const apiUrl = `${u.origin}/api/pcsx/position_details?position_id=${id}&domain=${domain}`;

  return fetchJD(apiUrl, signal, { logLabel: "eightfold JD" });
}
