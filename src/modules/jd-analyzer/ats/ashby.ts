import type { AshbyJob } from "@/modules/company-tacker/ats/ashby";

import { ASHBY_API_URL } from "@/constants/ats";

export async function fetchAshbyJD(url: string) {
  const u = new URL(url);
  const identifier = u.pathname.split("/")[1];

  const id = u.pathname.split("/")[2];

  const apiUrl = `${ASHBY_API_URL}/${identifier}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) {
      console.error(`Failed to fetch ashby JD from ${apiUrl}: ${res.statusText}`);
      return null;
    }

    const data: { jobs: AshbyJob[] } = await res.json();
    const jd = data.jobs.find((job: AshbyJob) => job.id === id) ?? null;
    if (!jd) return null;
    return JSON.stringify(jd);
  } catch (error) {
    console.error(`Error fetching ashby JD from ${apiUrl}: ${error}`);
    return null;
  }
}
