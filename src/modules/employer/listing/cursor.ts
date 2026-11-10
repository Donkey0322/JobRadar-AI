import type { Company } from "@/types";

import { AshbyBoard, type AshbyJob } from "./ashby";

import {
  CURSOR_CAREERS_URL,
  cursorCareerJobUrl,
  fetchCursorCareerSlugs,
  isCursorAshbyBoard,
} from "@/modules/ats/cursor-careers";
import { logger } from "@/utils/logger";

/**
 * Cursor keeps listing through Ashby, but jobs.ashbyhq.com/cursor 404s.
 * Store the careers page that is actually open, and keep ashby_jid so the
 * job key and the JD fetch stay on the Ashby board.
 */
export class CursorAshbyBoard extends AshbyBoard {
  protected async rewriteJobLinks(
    jobs: AshbyJob[],
    company: Company,
    signal: AbortSignal
  ): Promise<AshbyJob[]> {
    const slugs = await fetchCursorCareerSlugs(signal);

    if (!slugs || slugs.size === 0) {
      logger.warn(
        { company: company.name, url: CURSOR_CAREERS_URL },
        "⚠️ Cursor career slugs unavailable"
      );
      return jobs;
    }

    return jobs.map((job) => {
      const slug = slugs.get(job.id.toLowerCase());
      if (!slug) return job;

      return { ...job, jobUrl: cursorCareerJobUrl(slug, job.id) };
    });
  }
}

/** The Ashby board for Cursor. Null for every other company. */
export function cursorAshbyBoard(company: Company): CursorAshbyBoard | null {
  if (company.ats !== "ashby" || !isCursorAshbyBoard(company.identifier)) return null;

  return new CursorAshbyBoard(company);
}
