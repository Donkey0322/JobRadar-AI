export function renderMarkdown(
  records: ReadonlyArray<Record<string, unknown>>,
  options?: { jobStatus?: string }
): string;

export function renderSummary(options?: {
  dir?: string;
  summaryPath?: string;
  jobStatus?: string;
}): {
  wrote: boolean;
  markdown: string;
};

export function appendStage(record: object): boolean;

export function readStages(dir: string): Array<Record<string, unknown>>;
