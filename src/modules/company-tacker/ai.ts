import { ApiError, GoogleGenAI } from "@google/genai";

import type { Job } from "@/types";
import type { GenerateContentResponse } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const PERSONAL_GEMINI_API_KEY = process.env.BACKUP_GEMINI_API_KEY ?? "";

const DEFAULT_MODEL = "gemini-2.5-flash";

const LOCATION_SCHEMA = {
  type: "array",
  items: { type: "boolean" },
};

function calculateCost(response: GenerateContentResponse) {
  const usage = response.usageMetadata;

  if (usage) {
    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;

    const priceIn = 0.3 / 1_000_000;
    const priceOut = 2.5 / 1_000_000;

    const cost = inputTokens * priceIn + outputTokens * priceOut;

    console.log(`💲 Actual estimated cost: $${cost.toFixed(6)} USD`);
  }
}

async function callGeminiWithRetry(fn: () => Promise<GenerateContentResponse>, retries = 5) {
  let delay = 2000;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fn();
      calculateCost(response);
      return response;
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      throw e;
    }
  }

  throw new Error("Gemini failed after retries");
}

let RPD_REACHED = false;

export default async function callGemini(
  jobs: Job[],
  model: string = DEFAULT_MODEL
): Promise<boolean[] | null> {
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return null;
  }

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

  const params = {
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: LOCATION_SCHEMA,
    },
  };

  const apiKey = RPD_REACHED ? PERSONAL_GEMINI_API_KEY : GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const fn = () => client.models.generateContent(params);

    const response = await callGeminiWithRetry(fn);

    const text = response?.text ?? "";

    let parsed: boolean[] = [];
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error("❌ JSON parse failed:", text);
      return new Array(jobs.length).fill(true);
    }

    if (!Array.isArray(parsed) || parsed.length !== jobs.length) {
      console.error("❌ Length mismatch:", parsed);
      return new Array(jobs.length).fill(true);
    }

    return parsed;
  } catch (e) {
    if (e instanceof ApiError && e.status === 429 && apiKey === GEMINI_API_KEY) {
      console.log("❌ Rate limit exceeded. Retrying with personal API key...");
      RPD_REACHED = true;
      return await callGemini(jobs, model);
    }

    console.error(`Error calling Gemini: ${e}`);
    return new Array(jobs.length).fill(true);
  }
}
