import path from "node:path";

export const DATA_PATH = path.join(process.cwd(), "data");
export const URLS_PATH = path.join(DATA_PATH, "urls.json");
export const JOB_PATH = path.join(DATA_PATH, "jobs.ndjson");
export const OPPORTUNITIES_PATH = path.join(DATA_PATH, "opportunities.ndjson");
export const ARCHIVE_PATH = path.join(DATA_PATH, "archive");
export const JOB_ARCHIVE_CHUNK = 1000;
export const OPPORTUNITY_ARCHIVE_CHUNK = 5000;
export const COMPANY_PATH = path.join(DATA_PATH, "company.json");
export const ERROR_LOG_PATH = path.join(DATA_PATH, "discover-errors.log");
export const BATCH_PATH = path.join(DATA_PATH, "batch");
export const BATCH_QUEUE_PATH = path.join(BATCH_PATH, "queue.ndjson");
export const BATCH_INFLIGHT_PATH = path.join(BATCH_PATH, "inflight.json");
