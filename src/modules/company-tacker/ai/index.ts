import { promises as fs } from "fs";
import path from "path";

import { COUNTRIES } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";
import type { Country } from "@/validation/config";

import callAIModel from "@/utils/ai";
import { buildPrompt, toBulletList } from "@/utils/ai/prompt";
import { logger } from "@/utils/logger";

const BATCH_SIZE = 50;

interface LocationPayloadItem {
  index: number;
  title: string;
  location: string;
}

async function readPrompt(relativePath: string): Promise<string> {
  return await fs.readFile(path.join(import.meta.dirname, relativePath), "utf8");
}

function buildLocationSchema(length: number) {
  return {
    type: "array",
    items: {
      type: "string",
    },
    minItems: length,
    maxItems: length,
  };
}

function buildPayload(jobs: Job[]): LocationPayloadItem[] {
  return jobs.map((job, index) => ({
    index,
    title: job.role,
    location: job.location,
  }));
}

function parseLocationResult(result: string | null, expectedLength: number): Country[] {
  if (!result) {
    logger.error({ result }, `${RED_CROSS} Classify locations failed: empty AI result`);
    return Array(expectedLength).fill("Unsure");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(result);
  } catch (error) {
    logger.error({ err: error, result }, `${RED_CROSS} Failed to parse location result`);
    return Array(expectedLength).fill("Unsure");
  }

  if (!Array.isArray(parsed)) {
    logger.error({ result }, `${RED_CROSS} Location result is not an array`);
    return Array(expectedLength).fill("Unsure");
  }

  if (parsed.length !== expectedLength) {
    logger.error(
      { result, expectedLength, parsedLength: parsed.length },
      `${RED_CROSS} Length mismatch`
    );
    return Array(expectedLength).fill("Unsure");
  }

  const invalidItems = parsed.filter(
    (item) => typeof item !== "string" || !COUNTRIES.includes(item as Country)
  );

  if (invalidItems.length > 0) {
    logger.error({ invalidItems, result }, `${RED_CROSS} Invalid location values`);
    return Array(expectedLength).fill("Unsure");
  }

  return parsed as Country[];
}

async function classifyBatch(jobs: Job[]): Promise<{ result: Country[]; cost: number }> {
  if (process.env.AI_MODE === "DOWN") {
    return { result: Array(jobs.length).fill("Unsure"), cost: 0 };
  }
  try {
    const payload = buildPayload(jobs);
    const schema = buildLocationSchema(jobs.length);

    const template = await readPrompt("spec.txt");
    const prompt = buildPrompt(template, {
      COUNTRIES: toBulletList(COUNTRIES),
      PAYLOAD: JSON.stringify(payload, null, 2),
    });

    const { result, cost } = await callAIModel(prompt, schema);
    const classified = parseLocationResult(result, jobs.length);

    return {
      result: classified,
      cost,
    };
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Error classifying locations`);
    return { result: Array(jobs.length).fill("Unsure"), cost: 0 };
  }
}

export async function classifyLocations(jobs: Job[]): Promise<Country[]> {
  if (jobs.length === 0) {
    logger.info("🔍 No jobs to classify");
    return [];
  }

  logger.info({ total: jobs.length }, "🔍 Classifying locations...");

  const results: Country[] = [];
  let totalCost = 0;

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);

    const { result: classified, cost } = await classifyBatch(batch);

    results.push(...classified);
    totalCost += cost;
  }

  if (results.length !== jobs.length) {
    logger.error(
      { resultsLength: results.length, jobsLength: jobs.length },
      `${RED_CROSS} Final length mismatch`
    );
    return Array(jobs.length).fill("Unsure");
  }

  logger.info({ count: results.length, cost: totalCost }, "💰 Classified locations");

  return results;
}
