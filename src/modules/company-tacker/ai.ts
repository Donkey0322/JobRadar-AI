import { LOCATIONS } from "@/constants/location";
import { RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";
import type { Country } from "@/validation/config";

import callGemini from "@/utils/ai";
import { logger } from "@/utils/logger";

const BATCH_SIZE = 50;

async function classifyBatch(jobs: Job[]): Promise<Country[]> {
  const payload = jobs.map((job, index) => ({
    index,
    title: job.role,
    location: job.location,
  }));

  const LOCATION_SCHEMA = {
    type: "array",
    items: {
      type: "string",
    },
    minItems: jobs.length,
    maxItems: jobs.length,
  };

  const prompt = `
You are a strict classifier.

Task:
For each item, classify the job location.

Allowed values:
${LOCATIONS.join(", ")}

Rules:
- Return exactly ONE location per item.
- Preserve exact order.
- Do not skip items.
- Do not add items.

Guidelines:
- Use "USA" for United States jobs.
- Use "Remote" for fully remote jobs.
- Use "Unsure" if location cannot be determined or multiple locations are possible.
- Use "Other" if clearly outside supported regions.

Output format:
- Return ONLY valid JSON.
- No markdown.
- No explanation.
- Return ONLY a JSON array of strings.

Data:
${JSON.stringify(payload)}
`;

  const { result, cost } = await callGemini(prompt, LOCATION_SCHEMA);

  logger.info(
    {
      cost,
      batchSize: jobs.length,
    },
    "💰 Classify locations cost"
  );

  const parsed: unknown = JSON.parse(result ?? "[]");

  if (!Array.isArray(parsed)) {
    logger.error({ result }, `${RED_CROSS} Result is not an array`);

    throw new Error("Classify locations failed");
  }

  if (parsed.length !== jobs.length) {
    throw new Error(`Length mismatch: expected ${jobs.length}, got ${parsed.length}`);
  }

  if (!parsed.every((item) => typeof item === "string" && LOCATIONS.includes(item as Country))) {
    throw new Error("Invalid location values");
  }

  return parsed as Country[];
}

export async function classifyLocations(jobs: Job[]): Promise<Country[]> {
  logger.info(
    {
      total: jobs.length,
      batchSize: BATCH_SIZE,
    },
    "🔍 Classifying locations..."
  );

  const results: Country[] = [];

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);

    logger.info(
      {
        start: i,
        end: i + batch.length - 1,
      },
      "📦 Processing location batch"
    );

    const classified = await classifyBatch(batch);

    results.push(...classified);
  }

  if (results.length !== jobs.length) {
    throw new Error(`Final length mismatch: expected ${jobs.length}, got ${results.length}`);
  }

  return results;
}
