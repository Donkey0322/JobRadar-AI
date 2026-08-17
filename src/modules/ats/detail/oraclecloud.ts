import { ABORT_SIGNAL } from "@/constants";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

const convertOracleJDUrl = (url: string) => {
  const u = new URL(url);

  const match = u.pathname.match(/\/sites\/([^/]+)\/(?:jobs\/)?job\/([^/?#]+)/);
  if (!match) return null;

  const [, siteNumber, jobId] = match;

  return (
    `${u.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
    `?expand=all&onlyData=true` +
    `&finder=ById;Id="${jobId}",siteNumber=${siteNumber}`
  );
};

export async function fetchOracleJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const apiUrl = convertOracleJDUrl(url);

  if (!apiUrl) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Oracle job URL") };
  }

  return fetchJD(apiUrl, signal, {
    logLabel: "Oracle JD",
    transform: (data) => {
      const items = (data as { items?: unknown[] })?.items;
      return items?.[0] ? JSON.stringify(items[0]) : null;
    },
  });
}
