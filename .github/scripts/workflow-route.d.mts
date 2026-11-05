export const SCAN_CRONS: readonly string[];
export const SYNC_CRONS: readonly string[];
export const PIPELINE_PREFIXES: readonly string[];
export const EMPTY_TREE: string;
export const WEBHOOK_PUSH_COMMIT_CAP: number;

export interface MaintenanceTask {
  argv: string[];
  paths: string[];
  message: string;
}

export const MAINTENANCE: Readonly<Record<string, MaintenanceTask>>;

export interface GateResult {
  should_run: string;
  task: string;
  lookback_days: string;
  message: string;
}

export interface RouteResult {
  run: boolean;
  board: boolean;
  notify: boolean;
}

export interface PushBounds {
  status: string;
  from: string;
  to: string;
  reason: string;
}

export interface MaintenancePlan extends MaintenanceTask {
  task: string;
}

export function jobsGate(
  eventName: string,
  task: string,
  schedule: string,
  now: Date | string
): GateResult;

export function batchShouldStart(eventName: string, commitMessage: string): boolean;

export function batchDue(eventName: string, queue: string | null, inflight: string | null): boolean;

export function classifyFiles(files: string[]): RouteResult;

export function routePush(
  message: string,
  files: string[],
  messages?: string[] | null
): RouteResult;

export function resolvePushBounds(
  before: string,
  after: string,
  oldestParents: string[] | null,
  commitIds: string[]
): PushBounds;

export function collectShouldContinue(submitResult: string, checkpointResult: string): boolean;

export function notifyEnabled(config: { dashboard?: { notify?: unknown } | null }): boolean;

export function shouldNotify(
  boardResult: string,
  notify: boolean,
  send: boolean,
  prepareResult?: string
): boolean;

export function maintenancePlan(eventName: string, task: string): MaintenancePlan;
