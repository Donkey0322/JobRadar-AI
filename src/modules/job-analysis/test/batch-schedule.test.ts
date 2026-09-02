import { describe, expect, it } from "vitest";

import {
  BATCH_MAX_INTERVAL_MS,
  BATCH_MIN_INTERVAL_MS,
  clampBatchInterval,
  defaultBatchSchedule,
  isBatchCheckDue,
  planNextBatchCheck,
} from "../batch-schedule";

describe("clampBatchInterval", () => {
  it("floors intervals below GitHub's 5 minute schedule minimum", () => {
    expect(clampBatchInterval(4 * 60 * 1000)).toBe(BATCH_MIN_INTERVAL_MS);
  });

  it("caps intervals at one hour", () => {
    expect(clampBatchInterval(2 * 60 * 60 * 1000)).toBe(BATCH_MAX_INTERVAL_MS);
  });
});

describe("planNextBatchCheck", () => {
  const now = Date.parse("2026-09-01T23:00:00.000Z");
  const previous = {
    ...defaultBatchSchedule(),
    intervalMs: 4 * 60 * 1000,
    lastDurationMs: 4 * 60 * 1000,
  };

  it("uses the last completed duration after a successful collect and submit", () => {
    const next = planNextBatchCheck({
      previous,
      checkedTooEarly: false,
      hasInflight: true,
      submitted: 6,
      completedDurationMs: 4 * 60 * 1000,
      now,
    });

    expect(next.intervalMs).toBe(BATCH_MIN_INTERVAL_MS);
    expect(next.lastDurationMs).toBe(4 * 60 * 1000);
    expect(next.nextCheckAt).toBe(new Date(now + BATCH_MIN_INTERVAL_MS).toISOString());
  });

  it("doubles the wait when the previous batch is still pending", () => {
    const next = planNextBatchCheck({
      previous: { ...previous, intervalMs: BATCH_MIN_INTERVAL_MS },
      checkedTooEarly: true,
      hasInflight: true,
      submitted: 0,
      completedDurationMs: null,
      now,
    });

    expect(next.intervalMs).toBe(10 * 60 * 1000);
    expect(next.nextCheckAt).toBe(new Date(now + 10 * 60 * 1000).toISOString());
  });

  it("adopts the measured duration once a delayed batch finishes", () => {
    const next = planNextBatchCheck({
      previous: { ...previous, intervalMs: 8 * 60 * 1000 },
      checkedTooEarly: false,
      hasInflight: true,
      submitted: 0,
      completedDurationMs: 10 * 60 * 1000,
      now,
    });

    expect(next.intervalMs).toBe(10 * 60 * 1000);
    expect(next.lastDurationMs).toBe(10 * 60 * 1000);
  });

  it("falls back to the hourly cadence when nothing is inflight or queued", () => {
    const next = planNextBatchCheck({
      previous,
      checkedTooEarly: false,
      hasInflight: false,
      submitted: 0,
      completedDurationMs: 10 * 60 * 1000,
      now,
    });

    expect(next.intervalMs).toBe(BATCH_MAX_INTERVAL_MS);
    expect(next.lastDurationMs).toBe(10 * 60 * 1000);
  });
});

describe("isBatchCheckDue", () => {
  it("is due when the next check timestamp is in the past", () => {
    expect(
      isBatchCheckDue(
        { intervalMs: 5 * 60 * 1000, nextCheckAt: "2026-09-01T22:00:00.000Z", lastDurationMs: null },
        Date.parse("2026-09-01T23:00:00.000Z")
      )
    ).toBe(true);
  });

  it("is not due when the next check timestamp is in the future", () => {
    expect(
      isBatchCheckDue(
        { intervalMs: 5 * 60 * 1000, nextCheckAt: "2026-09-01T23:10:00.000Z", lastDurationMs: null },
        Date.parse("2026-09-01T23:00:00.000Z")
      )
    ).toBe(false);
  });
});
