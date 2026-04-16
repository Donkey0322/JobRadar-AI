import { logger } from "@/utils/logger";

export async function fetchWorkdayJD(url: string) {
  const u = new URL(url);
  const name = u.hostname.split(".")[0];
  const parts = u.pathname.split("/").filter(Boolean);
  const isLocale = (str: string) => /^[a-z]{2}-[A-Z]{2}$/.test(str);
  const careerPage = (parts.find((p) => !isLocale(p)) || "").toLowerCase();

  const index = parts.findIndex((p) => p === "job");
  if (index === -1) return null;

  const endpoint = parts.slice(index + 1).join("/");
  const apiUrl = `${u.origin}/wday/cxs/${name}/${careerPage}/job/${endpoint}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data) return null;
    return JSON.stringify(data);
  } catch (error) {
    logger.error({ err: error, apiUrl }, "❌ Error fetching workday JD");
    return null;
  }
}
