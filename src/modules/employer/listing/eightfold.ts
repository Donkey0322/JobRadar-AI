import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";
import { eightfoldDomain } from "../shared/eightfold";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { formatCompanyName } from "@/utils/string";

export const TRACKING_PARAM = "8fold_id";

/** Brand slug from an Eightfold company domain, e.g. microsoft.com → microsoft. */
function companySlug(domain: string): string {
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return host.split(".")[0] || host;
}

export const EightfoldJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  locations: z.array(z.string()),
  creationTs: z.number(),
  postedTs: z.number(),
  positionUrl: z.string(),
});

export type EightfoldJob = z.infer<typeof EightfoldJobSchema>;

export const EightfoldPcsxResponseSchema = z.object({
  data: z
    .object({
      positions: z.array(EightfoldJobSchema).optional(),
    })
    .optional(),
});

export const EightfoldApplyJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  locations: z.array(z.string()),
  t_create: z.number(),
  t_update: z.number().optional(),
  canonicalPositionUrl: z.string(),
});

export const EightfoldApplyResponseSchema = z.object({
  positions: z.array(EightfoldApplyJobSchema).optional(),
});

const PAGE_SIZE = 10;
const MAX_PAGES = 200;
const PCSX_DISABLED = "PCSX is not enabled for this user.";

function isPcsxDisabled(data: unknown): boolean {
  return (
    typeof data === "object" && data !== null && "message" in data && data.message === PCSX_DISABLED
  );
}

/** PCSX-off boards list jobs on the Apply API. Returns null when `page` is already that API. */
function applyListingPage(page: string): string | null {
  const url = new URL(page);
  if (!url.pathname.includes("/api/pcsx/")) return null;

  const domain = url.searchParams.get("domain");
  if (!domain) return null;

  return `${url.origin}/api/apply/v2/jobs?domain=${domain}`;
}

export class EightfoldFetcher extends Employer<EightfoldJob> {
  readonly ats = "eightfold" as const;

  companyKeyFromUrl(url: URL): string {
    return this.companyKey(this.getIdentifier(url));
  }

  async formCompany(url: URL): Promise<Company> {
    const identifier = this.getIdentifier(url);
    const domain = this.getDomain(url, identifier);

    let page = `${url.origin}/api/pcsx/search?domain=${domain}`;
    const response = await fetch(page);

    try {
      const data = (await response.json()) as { message?: string };

      if (data.message === PCSX_DISABLED) {
        page = `${url.origin}/api/apply/v2/jobs?domain=${domain}`;
      }
    } catch {
      // Non-JSON body (e.g. rate limit) — keep PCSX page and let fetch handle it.
    }

    return {
      name: this.getCompanyName(url, domain, identifier),
      ats: this.ats,
      identifier,
      domain,
      page,
      urls: [],
    };
  }

  private getDomain(url: URL, identifier: string): string {
    return eightfoldDomain(url, identifier);
  }

  /**
   * *.eightfold.ai hosts already use the company slug as the subdomain.
   * Custom career hosts keep that hostname as the identifier, and take the
   * display name from the company domain instead.
   */
  private getCompanyName(url: URL, domain: string, identifier: string): string {
    if (url.hostname.endsWith(".eightfold.ai")) {
      return identifier;
    }

    return companySlug(domain);
  }

  private getIdentifier(url: URL): string {
    return url.hostname.replace(".eightfold.ai", "");
  }

  protected getJobsFromResponse(data: unknown): EightfoldJob[] {
    const pcsxParsed = EightfoldPcsxResponseSchema.safeParse(data);

    if (pcsxParsed.success && pcsxParsed.data.data?.positions) {
      return pcsxParsed.data.data.positions;
    }

    const applyParsed = EightfoldApplyResponseSchema.safeParse(data);

    if (applyParsed.success) {
      return (applyParsed.data.positions ?? []).map((job) => ({
        id: job.id,
        name: job.name,
        locations: job.locations,
        creationTs: job.t_create,
        postedTs: job.t_update ?? job.t_create,
        positionUrl: new URL(job.canonicalPositionUrl).pathname,
      }));
    }

    logger.error(
      { data, issues: applyParsed.error.issues },
      `${RED_CROSS} Invalid Eightfold response`
    );
    return [];
  }

  protected getJobLink(job: EightfoldJob, company: Company): string {
    const url = new URL(company.page);
    url.pathname = job.positionUrl.startsWith("/") ? job.positionUrl : `/${job.positionUrl}`;
    url.searchParams.set(TRACKING_PARAM, String(job.id));
    return url.toString();
  }

  protected normalizeJob(job: EightfoldJob, company: Company): Job {
    return {
      company: formatCompanyName(company.name),
      role: job.name,
      link: this.getJobLink(job, company),
      location: job.locations.join(", "),
    };
  }

  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal
  ): Promise<EightfoldJob[] | null> {
    const jobs: EightfoldJob[] = [];
    let page = company.page;

    try {
      for (let index = 0; index < MAX_PAGES; index++) {
        const start = index * PAGE_SIZE;
        const result = await this.readListing(page, company.domain, start, signal);
        page = result.page;

        if (!result.response.ok) {
          return jobs.length > 0 ? jobs : null;
        }

        const rawJobs = this.getJobsFromResponse(result.body);
        if (rawJobs.length === 0) {
          break;
        }

        jobs.push(...rawJobs);
        if (rawJobs.length < PAGE_SIZE) {
          break;
        }
      }

      return jobs;
    } catch {
      return jobs.length > 0 ? jobs : null;
    }
  }

  private listingHeaders(domain: string, start: number): HeadersInit {
    return {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      referer: `${domain}/careers?start=${start}&sort_by=timestamp`,
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    };
  }

  private listingUrl(page: string, start: number): string {
    const url = new URL(page);
    url.searchParams.set("query", "");
    url.searchParams.set("location", "");
    url.searchParams.set("start", String(start));
    url.searchParams.set("sort_by", "timestamp");
    return url.toString();
  }

  /**
   * Read one listing page. A PCSX 403 whose body says the product is off
   * is retried once against the Apply API, and later pages stay on that API.
   */
  private async readListing(
    page: string,
    domain: string,
    start: number,
    signal: AbortSignal
  ): Promise<{ page: string; response: Response; body: unknown }> {
    const response = await fetch(this.listingUrl(page, start), {
      signal,
      headers: this.listingHeaders(domain, start),
    });
    const body = await response.json().catch(() => null);
    const fallback = !response.ok && isPcsxDisabled(body) ? applyListingPage(page) : null;

    if (!fallback) {
      return { page, response, body };
    }

    const retry = await fetch(this.listingUrl(fallback, start), {
      signal,
      headers: this.listingHeaders(domain, start),
    });

    return { page: fallback, response: retry, body: await retry.json().catch(() => null) };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    const allJobs: Job[] = [];
    let page = company.page;

    try {
      for (let index = 0; index < MAX_PAGES; index++) {
        const start = index * PAGE_SIZE;
        const result = await this.readListing(page, company.domain, start, signal);
        page = result.page;

        if (!result.response.ok) {
          await appendErrorLog(
            `Eightfold: ${company.name} - ${result.response.status} - ${result.response.statusText}`
          );
          break;
        }

        const rawJobs = this.getJobsFromResponse(result.body);
        if (rawJobs.length === 0) break;

        let reachedOldJob = false;
        const opportunities = rawJobs
          .map((job) => ({
            posting: this.posting(job, company, job.postedTs),
            hasPostedAt: Boolean(job.postedTs),
          }))
          .filter(({ posting, hasPostedAt }) => {
            if (hasPostedAt && !posting.isRecent()) {
              reachedOldJob = true;
              return false;
            }

            return posting.isTarget() && !posting.isKnown(knownKeys);
          })
          .map(({ posting }) => posting.toJob());

        allJobs.push(...opportunities);
        if (rawJobs.length < PAGE_SIZE || reachedOldJob) break;
      }

      return allJobs;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        logger.warn(
          {
            company: company.name,
            url: company.page,
          },
          "⚠️ Eightfold request aborted"
        );
        return [];
      }

      logger.error(
        {
          error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching eightfold jobs`
      );
      return [];
    }
  }
}

export const eightfoldFetcher = new EightfoldFetcher();
