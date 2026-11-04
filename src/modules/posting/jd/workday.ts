import { createJDFetchSignal } from "@/constants";

import type { JDFetchResult } from "./fetch";

import { fetchJD, JD_FETCH_ERROR } from "./fetch";

import { isWorkdayLocaleSegment } from "@/modules/employer/shared/workday";

/** CXS tenant and site: `recruiting/<tenant>/<site>` on myworkdaysite, else host and first path segment. */
function getCxsBoard(u: URL, parts: string[]): { tenant: string; site: string } {
  if (u.hostname.toLowerCase().endsWith("myworkdaysite.com")) {
    const recruitingIndex = parts.findIndex((p) => p.toLowerCase() === "recruiting");
    const tenant = parts[recruitingIndex + 1];
    const site = parts[recruitingIndex + 2];

    if (recruitingIndex !== -1 && tenant && site && site !== "job") {
      return { tenant, site };
    }
  }

  return {
    tenant: u.hostname.split(".")[0],
    site: (parts.find((p) => !isWorkdayLocaleSegment(p, "strict")) || "").toLowerCase(),
  };
}

export async function fetchWorkdayJD(
  url: string,
  signal: AbortSignal = createJDFetchSignal()
): Promise<JDFetchResult> {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);

  const index = parts.findIndex((p) => p === "job");
  if (index === -1) {
    return { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid Workday URL") };
  }

  const { tenant, site } = getCxsBoard(u, parts);
  const endpoint = parts.slice(index + 1).join("/");
  const apiUrl = `${u.origin}/wday/cxs/${tenant}/${site}/job/${endpoint}`;

  return fetchJD(apiUrl, signal, { logLabel: "workday JD" });
}
