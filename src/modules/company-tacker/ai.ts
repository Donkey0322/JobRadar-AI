import { RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";

import callGemini from "@/utils/ai";
import { logger } from "@/utils/logger";

export default async function classifyLocations(jobs: Job[]): Promise<Job[]> {
  const payload = jobs.map((job, index) => ({
    index,
    title: job.role,
    location: job.location,
    jdLocation: job.jd?.location,
  }));

  const LOCATION_SCHEMA = {
    type: "array",
    items: {
      type: "boolean",
    },
    minItems: jobs.length,
    maxItems: jobs.length,
  };

  const prompt = `
You are a strict classifier.

Task:
For each item, determine whether the job location is in the United States.

Rules:
- Return false ONLY if the location is clearly NOT in the United States
- Return true if:
  - The location is in the United States
  - The location is unclear
  - The location contains multiple places (example: "6 Locations")
  - The location is remote
  - The location is unspecified

Important:
- Output length MUST exactly match input length
- Preserve exact order
- Do NOT skip items
- Do NOT add items

Output format:
- Return ONLY a JSON array of booleans
- No markdown
- No explanation
- No extra text

Data:
${JSON.stringify(payload)}
`;

  const { result, cost } = await callGemini(prompt, LOCATION_SCHEMA);

  logger.info({ cost }, "💰 Classify locations cost");

  const text = result ?? "[]";

  try {
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) {
      logger.error({ text }, `${RED_CROSS} Result is not an array`);
      throw new Error("Classify locations failed");
    }

    if (parsed.length !== jobs.length) {
      logger.error(
        {
          difference: `expected ${jobs.length}, got ${parsed.length}`,
        },
        `${RED_CROSS} Length mismatch`
      );

      throw new Error("Classify locations failed");
    }

    if (!parsed.every((item) => typeof item === "boolean")) {
      logger.error({ text }, `${RED_CROSS} Invalid boolean array`);
      throw new Error("Classify locations failed");
    }

    return jobs.filter((_, index) => parsed[index]);
  } catch (error) {
    logger.error(
      {
        error,
      },
      `${RED_CROSS} JSON parse failed`
    );

    throw new Error("Classify locations failed", { cause: error });
  }
}
