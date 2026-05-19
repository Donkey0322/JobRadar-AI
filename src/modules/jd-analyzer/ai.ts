import { SEASONS } from "@/constants";
import { LOCATIONS } from "@/constants/location";
import { RED_CROSS } from "@/constants/log";

import type { AIResponse } from "@/utils/ai";

import callGemini from "@/utils/ai";
import { logger } from "@/utils/logger";

const JD_SCHEMA = {
  type: "object",

  properties: {
    citizenship_required: {
      type: "boolean",
      nullable: true,
    },

    visa_sponsorship_available: {
      type: "boolean",
      nullable: true,
    },

    location: {
      type: "string",
      enum: LOCATIONS,
    },

    qualifications: {
      type: "array",
      items: {
        type: "string",
      },
    },

    term: {
      type: "string",
      enum: SEASONS,
    },
  },

  required: [
    "citizenship_required",
    "visa_sponsorship_available",
    "location",
    "qualifications",
    "term",
  ],
};

export default async function analyzeJD(context: string): Promise<AIResponse> {
  const prompt = `
You are a recruiting analyst.

Extract structured information from the job description.

Fields:

1. citizenship_required
- true if citizenship is explicitly required
- false if explicitly not required
- null if unclear

2. visa_sponsorship_available
- true if sponsorship is available
- false if sponsorship is explicitly unavailable
- null if unclear

3. location
- classify into one supported location

4. qualifications
- extract ALL qualifications
- combine required and preferred qualifications

5. term
- determine internship season or seniority level
- if unclear, return "unsure"

Rules:
- Return ONLY valid JSON
- Do not include explanations
- Follow the schema exactly

Qualification formatting:
- Short clean bullet phrases
- Start with a capital letter
- Under 20 words
- Preserve original meaning

---BEGIN JD TEXT---
${context}
---END JD TEXT---
`;

  try {
    const response = await callGemini(prompt, JD_SCHEMA);
    return response ?? null;
  } catch (e) {
    logger.error({ err: e }, `${RED_CROSS} Error calling Gemini`);
    return { result: null, cost: 0 };
  }
}
