import type { ReplayReport } from "@/modules/employer/pinpoint-replay";

import {
  classifyPinpointReplay,
  PINPOINT_REPLAY_COMMIT,
  PINPOINT_REPLAY_URLS,
} from "@/modules/employer/pinpoint-replay";
import { loadBatchQueue, loadInflightBatches } from "@/modules/posting/batch";
import { BatchFailures } from "@/modules/posting/batch/failures";
import { PendingResults } from "@/modules/posting/batch/results";
import { companies } from "@/store/companies";
import { opportunities } from "@/store/opportunities";
import { urls } from "@/store/urls";

/**
 * Read-only review of the Pinpoint URLs added in `0ccaee30`.
 * A later apply pass fetches each board with `keysExcept(knownKeys, replayKeys)`,
 * then runs `processJobs` with that same set removed. Other postings keep both
 * dedup layers. This command does not fetch or write.
 */
export async function reviewPinpointReplay(): Promise<ReplayReport> {
  const [urlSet, companyRows, opportunityRows, queue, inflight, results, failures] =
    await Promise.all([
      urls.load(),
      companies.load(),
      opportunities.load(),
      loadBatchQueue(),
      loadInflightBatches(),
      PendingResults.load(),
      BatchFailures.load(),
    ]);

  const report = classifyPinpointReplay(PINPOINT_REPLAY_URLS, {
    urls: urlSet,
    companyUrls: companyRows.flatMap((company) => company.urls),
    opportunities: opportunityRows,
    queue,
    inflight,
    results: results.list(),
    failures: failures.list(),
  });

  const lines = [
    `Pinpoint replay review for ${PINPOINT_REPLAY_COMMIT} (${PINPOINT_REPLAY_URLS.length} URLs).`,
    "This is a dry run. It does not fetch boards or write data.",
    ...Object.entries(report.counts).map(([name, count]) => `${name}: ${count}`),
    "",
    ...report.rows.map((row) => `${row.disposition}\t${row.key}\t${row.reason}\t${row.url}`),
    "",
    "Later apply, not part of this command:",
    "1. Take replay=true keys from a fresh run of this review.",
    "2. Fetch each Pinpoint board with keysExcept(boardKnownKeys, those keys).",
    "3. Run processJobs with keysExcept(ingestKeys, those keys).",
    "4. Review again. Queued keys become in-progress, so a second apply does not enqueue them.",
    "Every key that is not replay=true stays in both known-key sets.",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
  return report;
}
