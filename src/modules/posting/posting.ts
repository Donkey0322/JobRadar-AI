import { ABORT_SIGNAL, ALLOWED_COUNTRIES, CONFIG } from "@/constants";

import type { PostingAnalysisResult } from "./analyze";
import type { JDFetchResult } from "./jd";
import type { JD, Job } from "@/types";

import { analyzePosting, extractQualifications } from "./analyze";
import { fetchPostingJD } from "./jd";
import { isNotifyCandidate, isTarget, shouldBatchAnalyze, withinDays } from "./titles";

import { getJobKey, isKnownJob } from "@/utils/job-key";

export type PostingDate = string | number | null | undefined;

export class Posting implements Job {
  company: string;
  role: string;
  link: string;
  location: string;

  declare id?: number;
  declare country?: Job["country"];
  declare jd?: JD | null;

  #dates: PostingDate[];

  constructor(job: Job, dates: PostingDate | readonly PostingDate[] = []) {
    this.company = job.company;
    this.role = job.role;
    this.link = job.link;
    this.location = job.location;
    this.#dates = Array.isArray(dates) ? [...dates] : [dates];

    if (job.id !== undefined) this.id = job.id;
    if (job.country !== undefined) this.country = job.country;
    if (job.jd !== undefined) this.jd = job.jd;
  }

  static from(job: Job, dates?: PostingDate | readonly PostingDate[]): Posting {
    if (job instanceof Posting && dates === undefined) return job;
    return new Posting(job, dates);
  }

  key(): string {
    return getJobKey(this.link);
  }

  isTarget(): boolean {
    return isTarget(this.role);
  }

  isKnown(knownKeys: ReadonlySet<string>): boolean {
    return isKnownJob(this.link, knownKeys);
  }

  isRecent(days = 1): boolean {
    return this.#dates.some((date) => withinDays(date, days));
  }

  shouldBatchAnalyze(): boolean {
    return shouldBatchAnalyze(this.role);
  }

  setJD(jd: JD | null): this {
    this.jd = jd;
    return this;
  }

  async getRawJD(signal: AbortSignal = ABORT_SIGNAL): Promise<JDFetchResult> {
    return fetchPostingJD(this.link, signal);
  }

  async analyze(options: PostingAnalyzeOptions = {}): Promise<PostingAnalysisResult> {
    const fetched =
      options.fetched ??
      (await this.getRawJD(options.signal ?? AbortSignal.timeout(5 * 60 * 1000)));
    const result = await analyzePosting(this.toJob(), fetched);
    this.setJD(result.jd);

    if (!this.jd || !this.needsQualifications()) {
      return {
        ...result,
        jd: this.jd ?? null,
      };
    }

    const qualificationResult = await extractQualifications(result.rawJD);

    if (qualificationResult.qualifications) {
      this.setJD({
        ...this.jd,
        qualifications: qualificationResult.qualifications,
      });
    }

    return {
      ...result,
      jd: this.jd ?? null,
      cost: result.cost + qualificationResult.cost,
    };
  }

  isEligible(): readonly [eligible: boolean, reason: string | null] {
    const jd = this.requireJD();
    const filters = CONFIG.target.filter;

    if (ALLOWED_COUNTRIES.size > 0 && !ALLOWED_COUNTRIES.has(jd.country)) {
      return [false, `${jd.country} is not in the allowed countries`];
    }

    const allowedCategories = new Set([
      ...(CONFIG.target?.intern ?? []),
      ...(CONFIG.target?.["full-time"] ?? []),
    ]);

    if (jd.category && !allowedCategories.has(jd.category)) {
      return [false, `${jd.category} is not in the allowed categories`];
    }

    if (!filters) {
      return [true, null];
    }

    const rules = [];

    if (jd.country === "Unsure") {
      for (const country of CONFIG.target.countries) {
        const rule = filters[country];
        if (rule) rules.push(rule);
      }
    } else {
      const rule = filters[jd.country];
      if (rule) rules.push(rule);
    }

    for (const rule of rules) {
      if (rule.allow_citizenship_required === false && jd.citizenship === true) {
        return [false, "citizenship is required"];
      }

      if (rule.allow_no_sponsorship === false && jd.sponsorship === false) {
        return [false, "sponsorship is not available"];
      }
    }

    return [true, null];
  }

  needsQualifications(): boolean {
    const jd = this.requireJD();

    if (jd.qualifications != null) return false;

    const [eligible] = this.isEligible();
    if (!eligible) return false;

    // A bare link has no role, so eligibility alone decides.
    return !this.role || isNotifyCandidate(this.role);
  }

  decideNotification() {
    const [eligible, reason] = this.isEligible();

    if (!eligible) {
      return {
        action: "skip" as const,
        kind: "ineligible" as const,
        reason,
      };
    }

    if (!isNotifyCandidate(this.role)) {
      return {
        action: "skip" as const,
        kind: "dashboard" as const,
        reason: null,
      };
    }

    return { action: "notify" as const, kind: null, reason: null };
  }

  toJob(): Job {
    const job: Job = {
      company: this.company,
      role: this.role,
      link: this.link,
      location: this.location,
    };

    if (this.id !== undefined) job.id = this.id;
    if (this.country !== undefined) job.country = this.country;
    if (this.jd !== undefined) job.jd = this.jd;

    return job;
  }

  private requireJD(): JD {
    if (!this.jd) {
      throw new Error("Posting must be analyzed before checking eligibility");
    }

    return this.jd;
  }
}

export const LINK_ANALYSIS_TIMEOUT_MS = 5000;

export interface PostingAnalyzeOptions {
  fetched?: JDFetchResult;
  signal?: AbortSignal;
}

export async function analyzeLink(link: string): Promise<JD | null> {
  const posting = Posting.from({
    company: "",
    role: "",
    link,
    location: "",
  });
  const result = await posting.analyze({
    signal: AbortSignal.timeout(LINK_ANALYSIS_TIMEOUT_MS),
  });
  return result.jd;
}
