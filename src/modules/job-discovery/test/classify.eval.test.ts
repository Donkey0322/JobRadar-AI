/**
 * Live quality eval for location classification. Hits the configured AI provider.
 *
 * These tests are excluded from `pnpm test`. Run:
 *   pnpm test:ai-eval
 */

import { beforeAll, describe, expect, it } from "vitest";

import { CONFIG } from "@/constants";

import type { Job } from "@/types";
import type { Country } from "@/validation/config";

import { classifyLocations } from "../ai";

const LOCATION_EVAL_CASES: Array<{
  role: string;
  location: string;
  expected: Country;
}> = [
  { role: "Software Engineer", location: "San Francisco, CA", expected: "USA" },
  { role: "Backend Engineer", location: "New York, NY, United States", expected: "USA" },
  { role: "Software Engineer", location: "Toronto, ON", expected: "Canada" },
  { role: "Software Engineer", location: "London, UK", expected: "UK" },
  { role: "Software Engineer", location: "Berlin, Germany", expected: "Germany" },
  { role: "Software Engineer", location: "Remote", expected: "Remote" },
  {
    role: "Software Engineer",
    location: "Remote - United States",
    expected: "USA",
  },
  {
    role: "Software Engineer",
    location: "San Francisco, CA or New York, NY",
    expected: "Unsure",
  },
];

beforeAll(() => {
  if (!CONFIG.ai.enabled) {
    throw new Error("AI is disabled in config.json; enable it to run location evals");
  }

  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY is required to run location evals");
  }

  process.env.AI_MODE = "ON";
});

describe("classifyLocations quality", () => {
  it("classifies a batch of locations", async () => {
    const jobs: Job[] = LOCATION_EVAL_CASES.map((testCase, index) => ({
      company: "Eval",
      role: testCase.role,
      link: `https://example.com/${index}`,
      location: testCase.location,
    }));

    const results = await classifyLocations(jobs);

    expect(results).toHaveLength(LOCATION_EVAL_CASES.length);

    for (const [index, testCase] of LOCATION_EVAL_CASES.entries()) {
      expect(results[index], testCase.location).toBe(testCase.expected);
    }
  });
});
