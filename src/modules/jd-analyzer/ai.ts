import type { AIResponse } from "@/utils/ai";

import { LOCATIONS, SEASONS } from "@/constants";
import callGemini from "@/utils/ai";
import { logger } from "@/utils/logger";

const JD_SCHEMA = {
  type: "object",
  properties: {
    requires_usa_citizenship: {
      type: "string",
      enum: ["yes", "no", "unsure"],
    },
    offers_visa_sponsorship: {
      type: "string",
      enum: ["yes", "no", "unsure"],
    },
    location: {
      type: "string",
      enum: LOCATIONS,
    },
    qualifications: {
      type: "array",
      items: { type: "string" },
    },
    term: {
      type: "string",
      enum: SEASONS,
    },
  },
  required: [
    "requires_usa_citizenship",
    "offers_visa_sponsorship",
    "qualifications",
    "term",
    "location",
  ],
};

export default async function analyzeJD(context: string): Promise<AIResponse> {
  const prompt = `
    You are a recruiting analyst.

    Extract from the job description:
    1. Whether USA citizenship is required.
    2. Whether the employer offers visa sponsorship.
    3. The location of the job.
    3. ALL qualifications (basic and preferred combined).
    4. The job term. If the term is not clear, return "unsure". If it is a full-time new grad position, return "New Grad".

    Rules:
    - If unclear or missing, return "unsure".
    - If sponsorship is not clearly stated, return "unsure".
    - Return ONLY valid JSON.
    - Do NOT include explanations.
    - Follow the schema exactly.
    - For the qualifications:
  
    Formatting rules for qualifications:
    - Return each qualification as a short, clean bullet phrase.
    - Start with a capital letter.
    - Prefer starting with a verb (e.g., "Develop", "Design", "Build") 
      or an adjective (e.g., "Strong", "Proficient", "Excellent").
    - Do not rewrite meaning.
    - Do not add new information.
    - Keep each qualification concise (under 20 words).

    ---BEGIN JD TEXT---
    ${context}
    ---END JD TEXT---
  `;

  try {
    const response = await callGemini(prompt, JD_SCHEMA);
    return response ?? null;
  } catch (e) {
    logger.error({ err: e }, "❌ Error calling Gemini");
    return { result: null, cost: 0 };
  }
}
