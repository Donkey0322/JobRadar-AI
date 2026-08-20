/**
 * Live quality eval for JD analysis. Hits the configured AI provider.
 *
 * These tests are excluded from `pnpm test`. Run:
 *   pnpm test:ai-eval
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONFIG } from "@/constants";

import analyzeJD from "../ai";
import { parseAIJDResult } from "../response";

import { JD_EVAL_CASES } from "./eval-cases";

import { logger } from "@/utils/logger";

beforeAll(() => {
  if (!CONFIG.ai.enabled) {
    throw new Error("AI is disabled in config.json; enable it to run JD evals");
  }

  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY is required to run JD evals");
  }

  process.env.AI_MODE = "ON";
});

describe("analyzeJD quality", () => {
  let totalCost = 0;

  afterAll(() => {
    logger.info(
      {
        cases: JD_EVAL_CASES.length,
        cost: totalCost,
        model: CONFIG.ai.enabled ? CONFIG.ai.model : "disabled",
      },
      "JD eval finished"
    );
  });

  it.each(JD_EVAL_CASES)("$name", async ({ jd, expected }) => {
    const response = await analyzeJD(jd);
    totalCost += response.cost;

    expect(response.result, "AI returned an empty result").toBeTruthy();

    const parsed = parseAIJDResult(response.result ?? "");
    expect(parsed.status, JSON.stringify(parsed)).toBe("ok");

    if (parsed.status !== "ok") {
      return;
    }

    expect(parsed.jd.citizenship).toBe(expected.citizenship);
    expect(parsed.jd.sponsorship).toBe(expected.sponsorship);
    expect(parsed.jd.country).toBe(expected.country);
    expect(parsed.jd.category).toBe(expected.category);
    expect(parsed.jd.season).toBe(expected.season);

    if (expected.locationIncludes) {
      expect(parsed.jd.location ?? "").toContain(expected.locationIncludes);
    }
  });
});
