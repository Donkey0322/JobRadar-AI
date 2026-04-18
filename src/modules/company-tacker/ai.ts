import { RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";

import callGemini from "@/utils/ai";
import { logger } from "@/utils/logger";

const LOCATION_SCHEMA = {
  type: "array",
  items: { type: "boolean" },
};

export default async function classifyLocations(jobs: Job[]): Promise<boolean[] | null> {
  const prompt = `
You are a strict classifier.

Task:
For each item, determine if the job location is in the United States.

Rules:
- Return false ONLY if the location is clearly NOT in the United States.
- Return true if:
  - The location is in the US
  - The location is unclear
  - The location has multiple places (e.g., "6 Locations")
  - The location is remote or unspecified

Output:
- Return ONLY a JSON array of booleans
- Same order as input
- No explanation

Data:
${JSON.stringify(jobs)}
`;

  const { result, cost } = await callGemini(prompt, LOCATION_SCHEMA);
  const text = result ?? "[]";
  logger.info({ cost }, "💰 Classify locations cost");

  try {
    const parsed: boolean[] = JSON.parse(text);

    if (!Array.isArray(parsed) || parsed.length !== jobs.length) {
      logger.error({ parsed }, `${RED_CROSS} Length mismatch`);
      return new Array(jobs.length).fill(true);
    }

    return parsed;
  } catch {
    logger.error({ text }, `${RED_CROSS} JSON parse failed`);
    return new Array(jobs.length).fill(true);
  }
}
