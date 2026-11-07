import type { OpportunityStop } from "@/types";

import { getJobKey } from "@/modules/ats/job-key";
import { parseStoredJD } from "@/modules/posting/analysis/validation/ai";

/** Posting URLs added to `data/urls.json` in `0ccaee30`. */
export const PINPOINT_REPLAY_COMMIT = "0ccaee30";

export const PINPOINT_REPLAY_URLS = [
  "https://idtus.pinpointhq.com/en/postings/1b7cfa64-36f0-45f7-8c53-7889aac425a4",
  "https://idtus.pinpointhq.com/en/postings/2e5dba8e-2428-403b-9a13-9af1e1ddb28d",
  "https://idtus.pinpointhq.com/en/postings/3ffe3459-d01a-4ccc-8005-c6d00f2ce6cc",
  "https://idtus.pinpointhq.com/en/postings/54b8d7c2-b726-4114-8f26-e8d8a5d96d2a",
  "https://idtus.pinpointhq.com/en/postings/5f1743ef-c7d6-4a67-9951-60917bb1db46",
  "https://idtus.pinpointhq.com/en/postings/73bd372e-d73d-460b-a645-4535ef45e517",
  "https://idtus.pinpointhq.com/en/postings/76e6a518-b747-459e-b3c5-221aacb5be1f",
  "https://idtus.pinpointhq.com/en/postings/7f0d1270-7754-4346-9c73-1fe45e086258",
  "https://idtus.pinpointhq.com/en/postings/882a011a-dd44-487a-a54b-11bb7afef866",
  "https://idtus.pinpointhq.com/en/postings/892f764b-ac12-4918-9250-c636b382ee0b",
  "https://idtus.pinpointhq.com/en/postings/ad705548-ecaf-44a6-b968-2513c9a3df67",
  "https://idtus.pinpointhq.com/en/postings/aff26b09-b170-4ce6-8dbb-a046589c0481",
  "https://idtus.pinpointhq.com/en/postings/b0ef7877-f9fd-4d79-ab02-bc53b9f3f7f4",
  "https://idtus.pinpointhq.com/en/postings/b542c38e-8f15-4abc-b9c8-302d09b8a21d",
  "https://idtus.pinpointhq.com/en/postings/b97b5659-6968-4e94-9e74-78dd8f1e269c",
  "https://idtus.pinpointhq.com/en/postings/bb42cc49-8e78-4ead-b8a8-ab05622cbfee",
  "https://idtus.pinpointhq.com/en/postings/cd69d5eb-22ff-4906-8039-f55ce9d78b8e",
  "https://idtus.pinpointhq.com/en/postings/e6cc0887-3696-404a-8295-ac95d776dfb8",
  "https://idtus.pinpointhq.com/en/postings/ed1a2fe2-8ab7-43c1-864a-07eda2bd0bb2",
  "https://idtus.pinpointhq.com/en/postings/fe670886-2819-491e-91ee-1f1ab39eda18",
  "https://impulsespace.pinpointhq.com/en/postings/53615b51-6458-4464-894d-f48d8b91711b",
  "https://impulsespace.pinpointhq.com/en/postings/5811788c-fc81-4390-b3c7-7fc226f15129",
  "https://impulsespace.pinpointhq.com/en/postings/59b09673-de5e-4ffc-a976-8ebdb3bb8d56",
  "https://impulsespace.pinpointhq.com/en/postings/8cc9e5d6-5b54-4584-9fd8-658a1b22fd4c",
  "https://impulsespace.pinpointhq.com/en/postings/a381de62-90c2-480d-aba5-9fd5210f22da",
  "https://impulsespace.pinpointhq.com/en/postings/c0221837-8793-4ff0-b8de-de869c3564a3",
  "https://impulsespace.pinpointhq.com/en/postings/d81245f6-a6d4-432f-b301-83be3007cebe",
  "https://impulsespace.pinpointhq.com/en/postings/f1a97726-7f3d-48b5-a659-722fb549de2c",
  "https://impulsespace.pinpointhq.com/en/postings/f9dd5869-8d18-4645-8176-d48a0ba20ffb",
  "https://wolve.pinpointhq.com/en/postings/856f5215-88c8-4c1b-bd47-5106b33ed37f",
  "https://wolve.pinpointhq.com/en/postings/c14659a9-52a3-4f09-8ebb-763899dee310",
  "https://wolve.pinpointhq.com/en/postings/ccc46db1-222a-4254-a731-3dd3225fbbf0",
  "https://wolve.pinpointhq.com/en/postings/ce3f9cb7-4219-4676-8241-5c8b7903d4c6",
] as const;

export type ReplayDisposition =
  | "replay"
  | "in-progress"
  | "valid-jd"
  | "confirm-liveness"
  | "stopped";

export interface ReplayOpportunity {
  link: string;
  jd?: unknown;
  expired?: boolean;
  stop?: Pick<OpportunityStop, "reason">;
}

export interface ReplaySnapshot {
  urls: Iterable<string>;
  companyUrls: Iterable<string>;
  opportunities: readonly ReplayOpportunity[];
  queue: readonly { link?: string }[];
  inflight: readonly { jobs?: readonly { link?: string }[] }[];
  results: readonly { key?: string; jd?: unknown }[];
  failures: readonly { key?: string; status?: string }[];
}

export interface ReplayRow {
  url: string;
  key: string;
  disposition: ReplayDisposition;
  replay: boolean;
  reason: string;
}

export interface ReplayReport {
  rows: ReplayRow[];
  counts: Record<ReplayDisposition, number>;
}

/** Known keys minus the approved replay set. Every other key keeps the normal dedup. */
export function keysExcept(keys: Iterable<string>, reopen: ReadonlySet<string>): Set<string> {
  const next = new Set(keys);

  for (const key of reopen) {
    next.delete(key);
  }

  return next;
}

export function replayKeySet(rows: readonly ReplayRow[]): Set<string> {
  return new Set(rows.filter((row) => row.replay).map((row) => row.key));
}

function keySet(links: Iterable<{ link?: string } | string>): Set<string> {
  const keys = new Set<string>();

  for (const item of links) {
    const link = typeof item === "string" ? item : item.link;

    if (!link) {
      continue;
    }

    const key = getJobKey(link);

    if (key) {
      keys.add(key);
    }
  }

  return keys;
}

/**
 * Classifies one committed Pinpoint URL against the current dataset.
 * A legal JD wins, then a row that needs a live check, then work already in
 * flight. Only the remaining known-but-unprocessed URLs are replayable.
 */
export function classifyPinpointReplay(
  urls: readonly string[],
  data: ReplaySnapshot
): ReplayReport {
  const knownUrls = keySet(data.urls);
  const companyUrls = keySet(data.companyUrls);
  const queued = keySet(data.queue);
  const inflight = new Set<string>();

  for (const batch of data.inflight) {
    for (const key of keySet(batch.jobs ?? [])) {
      inflight.add(key);
    }
  }

  const opportunities = new Map<string, ReplayOpportunity>();

  for (const row of data.opportunities) {
    const key = row.link ? getJobKey(row.link) : "";

    if (key && !opportunities.has(key)) {
      opportunities.set(key, row);
    }
  }

  const results = new Map<string, { jd?: unknown }>();

  for (const result of data.results) {
    if (result.key && !results.has(result.key)) {
      results.set(result.key, result);
    }
  }

  const failures = new Map<string, string>();

  for (const record of data.failures) {
    if (record.key && !failures.has(record.key)) {
      failures.set(record.key, record.status ?? "");
    }
  }

  const rows = urls.map((url) =>
    classifyOne(url, {
      knownUrls,
      companyUrls,
      queued,
      inflight,
      opportunities,
      results,
      failures,
    })
  );
  const counts: Record<ReplayDisposition, number> = {
    replay: 0,
    "in-progress": 0,
    "valid-jd": 0,
    "confirm-liveness": 0,
    stopped: 0,
  };

  for (const row of rows) {
    counts[row.disposition] += 1;
  }

  return { rows, counts };
}

function classifyOne(
  url: string,
  index: {
    knownUrls: Set<string>;
    companyUrls: Set<string>;
    queued: Set<string>;
    inflight: Set<string>;
    opportunities: Map<string, ReplayOpportunity>;
    results: Map<string, { jd?: unknown }>;
    failures: Map<string, string>;
  }
): ReplayRow {
  const key = getJobKey(url);
  const opportunity = index.opportunities.get(key);
  const result = index.results.get(key);
  const base = { url, key };

  if (parseStoredJD(opportunity?.jd) || parseStoredJD(result?.jd)) {
    return { ...base, disposition: "valid-jd", replay: false, reason: "已有合法 JD" };
  }

  if (opportunity?.expired || opportunity?.stop?.reason === "gone") {
    return {
      ...base,
      disposition: "confirm-liveness",
      replay: false,
      reason: "需要先確認存活",
    };
  }

  const status = index.failures.get(key);
  const inProgress =
    index.queued.has(key) ||
    index.inflight.has(key) ||
    result !== undefined ||
    status === "retrying";

  if (inProgress) {
    return { ...base, disposition: "in-progress", replay: false, reason: "已在處理" };
  }

  if (status === "failed") {
    return {
      ...base,
      disposition: "stopped",
      replay: false,
      reason: "失敗紀錄已終止，這次不重跑",
    };
  }

  if (!index.knownUrls.has(key) && !index.companyUrls.has(key) && !opportunity) {
    return {
      ...base,
      disposition: "confirm-liveness",
      replay: false,
      reason: "目前 urls 與公司 urls 都沒有這筆，需要先確認存活",
    };
  }

  return {
    ...base,
    disposition: "replay",
    replay: true,
    reason: "在目前資料裡，沒有合法 JD，也沒有進行中的工作",
  };
}
