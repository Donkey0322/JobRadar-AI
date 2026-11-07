import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  CONFIG: {
    dashboard: { notify: true },
    sender: { email: "from@example.com", host: "smtp.example", auth: { pass: "super-secret-pass" } },
    receiver: { emails: ["one@example.com", "two@example.com"] },
  },
}));
const sendMail = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
const getNewJobsFromDiff = vi.hoisted(() => vi.fn());

vi.mock("@/config", () => config);
vi.mock("../../utils/mail", () => ({
  createSMTPTransport: () => ({ close, sendMail }),
}));
vi.mock("../notify/git", () => ({ getNewJobsFromDiff }));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { renderSummary } from "@github/scripts/summary.mjs";

import notifyRange from "../notify/range";

const temps: string[] = [];

afterEach(() => {
  delete process.env.JOBRADAR_SUMMARY_DIR;
  config.CONFIG.dashboard.notify = true;
  sendMail.mockReset();
  getNewJobsFromDiff.mockReset();
  close.mockReset();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function summaryDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "jobradar-summary-notify-"));
  temps.push(dir);
  process.env.JOBRADAR_SUMMARY_DIR = dir;
  return dir;
}

describe("notification summary", () => {
  it("records a measured zero when the diff has no jobs", async () => {
    const dir = summaryDir();
    getNewJobsFromDiff.mockReturnValue([]);

    await notifyRange("a".repeat(40), "b".repeat(40));

    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("| Status | success |");
    expect(markdown).toContain("| Reason | no new jobs |");
    expect(markdown).toContain("| Jobs in range | 0 |");
    expect(markdown).toContain("| Jobs notified | 0 |");
    expect(markdown).not.toContain("Emails sent");
    expect(markdown).not.toContain("super-secret-pass");
    expect(markdown).not.toContain("person@example.com");
  });

  it("counts only jobs whose notification finished, not individual messages", async () => {
    const dir = summaryDir();
    getNewJobsFromDiff.mockReturnValue([
      { company: "Acme", role: "Secret Role", link: "https://example.com/full-jd" },
      { company: "Beta", role: "Other Role", link: "https://example.com/other" },
    ]);
    sendMail
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("smtp down"));

    await expect(notifyRange("a".repeat(40), "b".repeat(40))).rejects.toThrow("smtp down");

    const raw = readFileSync(path.join(dir, "stages.ndjson"), "utf8");
    expect(raw).not.toContain("super-secret-pass");
    expect(raw).not.toContain("Secret Role");
    expect(raw).not.toContain("full-jd");
    expect(raw).not.toContain("one@example.com");
    expect(raw).not.toContain("two@example.com");
    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("| Status | failed |");
    expect(markdown).toContain("| Jobs in range | 2 |");
    expect(markdown).toContain("| Jobs notified | 1 |");
    expect(markdown).toContain("| Messages | unknown |");
    expect(markdown).toContain("some messages may already have been sent");
    expect(markdown).toContain("| Written locally | unchanged |");
    expect(markdown).not.toContain("Emails sent");
    expect(markdown).not.toContain("one@example.com");
    expect(markdown).not.toContain("super-secret-pass");
    expect(sendMail).toHaveBeenCalledTimes(4);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not count a job when a later recipient fails", async () => {
    const dir = summaryDir();
    getNewJobsFromDiff.mockReturnValue([
      { company: "Acme", role: "Secret Role", link: "https://example.com/full-jd" },
    ]);
    sendMail.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("smtp down"));

    await expect(notifyRange("c".repeat(40), "d".repeat(40))).rejects.toThrow("smtp down");

    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("| Jobs in range | 1 |");
    expect(markdown).toContain("| Jobs notified | 0 |");
    expect(markdown).toContain("| Messages | unknown |");
    expect(markdown).not.toContain("Emails sent");
    expect(markdown).not.toContain("one@example.com");
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("skips without inventing a sent count when notifications are disabled", async () => {
    const dir = summaryDir();
    config.CONFIG.dashboard.notify = false;

    await notifyRange("a".repeat(40), "b".repeat(40));

    const raw = readFileSync(path.join(dir, "stages.ndjson"), "utf8");
    expect(raw).toContain('"status":"skipped"');
    expect(raw).not.toContain("sent");
    expect(getNewJobsFromDiff).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    const { markdown } = renderSummary({ dir, summaryPath: path.join(dir, "summary.md") });
    expect(markdown).toContain("| Reason | notifications disabled |");
    expect(markdown).not.toContain("Emails sent");
  });

  it("adds completed jobs across non-overlapping ranges and keeps an earlier send failure", async () => {
    const dir = summaryDir();
    const from = "a".repeat(40);
    const middle = "b".repeat(40);
    const to = "c".repeat(40);
    const job = (company: string) => ({
      company,
      role: "Secret Role",
      link: `https://example.com/${company}`,
    });
    getNewJobsFromDiff
      .mockReturnValueOnce([job("One"), job("Two")])
      .mockReturnValueOnce([job("Three"), job("Four"), job("Five")]);
    sendMail.mockResolvedValue({});

    await notifyRange(from, middle);
    await notifyRange(middle, to);

    const added = renderSummary({ dir, summaryPath: path.join(dir, "added.md") });
    const addedHead = added.markdown.slice(0, added.markdown.indexOf("<details>"));
    expect(addedHead).toContain("| Notifications | 5 jobs notified |");
    expect(addedHead).not.toContain("3 jobs notified");
    expect(added.markdown).not.toContain("one@example.com");
    expect(added.markdown).not.toContain("Secret Role");

    const failedDir = summaryDir();
    getNewJobsFromDiff
      .mockReturnValueOnce([job("One"), job("Two")])
      .mockReturnValueOnce([job("Three"), job("Four"), job("Five")]);
    sendMail.mockReset();
    sendMail
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("smtp down"));

    await expect(notifyRange(from, middle)).rejects.toThrow("smtp down");
    sendMail.mockReset();
    sendMail.mockResolvedValue({});
    await notifyRange(middle, to);

    const failed = renderSummary({ dir: failedDir, summaryPath: path.join(failedDir, "failed.md") });
    const failedHead = failed.markdown.slice(0, failed.markdown.indexOf("<details>"));
    expect(failedHead).toContain("4 jobs notified");
    expect(failedHead).toContain("some messages may already have been sent");
    expect(failed.markdown).not.toContain("one@example.com");
    expect(failed.markdown).not.toContain("Secret Role");
  }, 20_000);

  it("does not count the same notification event twice or sum an overlapping range", async () => {
    const dir = summaryDir();
    const from = "a".repeat(40);
    const to = "b".repeat(40);
    getNewJobsFromDiff.mockReturnValue([
      { company: "One", role: "Secret Role", link: "https://example.com/one" },
      { company: "Two", role: "Secret Role", link: "https://example.com/two" },
    ]);
    sendMail.mockResolvedValue({});

    await notifyRange(from, to);
    const stage = path.join(dir, "stages.ndjson");
    const line = readFileSync(stage, "utf8").trim().split("\n").at(-1) ?? "";
    appendFileSync(stage, `${line}\n`);

    const repeated = renderSummary({ dir, summaryPath: path.join(dir, "repeated.md") });
    const repeatedHead = repeated.markdown.slice(0, repeated.markdown.indexOf("<details>"));
    expect(repeatedHead).toContain("| Notifications | 2 jobs notified |");
    expect(repeatedHead).not.toContain("4 jobs notified");

    await notifyRange(from, to);
    const overlap = renderSummary({ dir, summaryPath: path.join(dir, "overlap.md") });
    const overlapHead = overlap.markdown.slice(0, overlap.markdown.indexOf("<details>"));
    expect(overlapHead).toContain("notification completions 2 + 2");
    expect(overlapHead).not.toContain("4 jobs notified");
    expect(overlap.markdown).not.toContain("Secret Role");
  }, 15_000);
});
