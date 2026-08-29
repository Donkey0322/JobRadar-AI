import pLimit from "p-limit";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { JDFetchResult, JDFetchStatus } from "@/modules/ats/detail";
import type { Opportunity } from "@/types";

import deduplicate, { syncExpiredFlags } from "./dedup";

import { isTarget } from "@/modules/ats/core/filter";
import { HttpStatusCode, NETWORK_ERROR_CODE } from "@/modules/ats/detail/fetch";
import { getRawJD } from "@/modules/job-analysis";
import { buildCompanyList } from "@/modules/job-discovery/company";
import { loadOpportunities, loadUrls, saveOpportunities, saveUrls } from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { groupUrlsByKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

const CONCURRENCY = 10;
const MAX_RETRIES = 4;
const INITIAL_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: JDFetchStatus): boolean {
  return error.code === HttpStatusCode.TOO_MANY_REQUESTS || error.code === NETWORK_ERROR_CODE;
}

async function getRawJDWithRetry(url: string): Promise<JDFetchResult> {
  let delay = INITIAL_DELAY_MS;
  let result = await getRawJD(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));

  for (let attempt = 0; attempt < MAX_RETRIES && isRetryable(result.error); attempt++) {
    const jitter = Math.floor(Math.random() * 250);
    await sleep(delay + jitter);
    result = await getRawJD(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));
    delay *= 2;
  }

  return result;
}

async function main() {
  await deduplicate();
  const sent = await loadUrls();
  const urls = Array.from(sent);

  const untargetedOpportunities = new Set<string>();
  const targetedOpportunities: Opportunity[] = [];
  const jobs = await loadOpportunities();
  for (const job of jobs) {
    if (!isTarget(job.role)) {
      untargetedOpportunities.add(job.link);
    } else {
      targetedOpportunities.push(job);
    }
  }

  const limit = pLimit(CONCURRENCY);
  let completed = 0;
  const total = urls.length;

  startProgress(total);

  const validUrls = (
    await Promise.all(
      urls.map((url) =>
        limit(async () => {
          const { error } = await getRawJDWithRetry(url);

          completed++;
          renderProgress(completed, total);

          if (untargetedOpportunities.has(url)) {
            return null;
          }

          if (HttpStatusCode.isError(error.code)) {
            return null;
          }
          if (!HttpStatusCode.isOk(error.code)) {
            console.error({ url, error }, `${RED_CROSS} Error fetching JD`);
          }
          return url;
        })
      )
    )
  ).filter((url): url is string => url !== null);

  console.log({ validUrls: validUrls.length }, `${GREEN_CHECKMARK} Successfully cleaned urls`);

  await saveUrls(new Set(validUrls));
  await saveOpportunities(syncExpiredFlags(targetedOpportunities, groupUrlsByKey(validUrls)), true);

  return validUrls;
}

// set silent to true
logger.level = "silent";
main()
  .then((urls) => buildCompanyList(urls))
  .catch((err) => {
    logger.fatal({ err }, `${RED_CROSS} Fatal error`);
    process.exit(1);
  });
