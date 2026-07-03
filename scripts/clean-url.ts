import pLimit from "p-limit";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";

import { buildCompanyList } from "@/modules/company-tacker/company";
import { isTarget } from "@/modules/company-tacker/utils";
import { getRawJD } from "@/modules/jd-analyzer";
import { HttpStatusCode } from "@/modules/jd-analyzer/ats/fetch";
import { loadOpportunities, loadUrls, saveOpportunities } from "@/utils/data";
import { saveUrls } from "@/utils/data";
import { renderProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 20;

async function main() {
  const sent = await loadUrls();
  const urls = Array.from(sent);

  const untargetedOpportunities = new Set<string>();
  const targetedOpportunities: Job[] = [];
  const jobs = await loadOpportunities();
  for (const job of jobs) {
    if (!isTarget(job.role)) {
      untargetedOpportunities.add(job.link);
    } else {
      targetedOpportunities.push(job);
    }
  }
  await saveOpportunities(targetedOpportunities, true);

  const limit = pLimit(CONCURRENCY);
  let completed = 0;
  const total = urls.length;

  const validUrls = (
    await Promise.all(
      urls.map((url) =>
        limit(async () => {
          const { error } = await getRawJD(url, AbortSignal.timeout(5 * 60 * 1000));

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
