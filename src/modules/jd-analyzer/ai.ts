import { ApiError, GoogleGenAI } from "@google/genai";

import type { GenerateContentResponse } from "@google/genai";

import { LOCATIONS } from "@/constants";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const PERSONAL_GEMINI_API_KEY = process.env.BACKUP_GEMINI_API_KEY ?? "";
const DEFAULT_MODEL = "gemini-2.5-flash";
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
      enum: [
        "2026 Winter",
        "2026 Spring",
        "2026 Summer",
        "2026 Fall",
        "2027 Spring",
        "2027 Winter",
        "New Grad",
        "unsure",
      ],
    },
  },
  required: ["requires_usa_citizenship", "offers_visa_sponsorship", "qualifications", "term"],
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
  contextText: string,
  model: string = DEFAULT_MODEL
): Promise<string | null> {
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return null;
  }
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
    ${contextText}
    ---END JD TEXT---
  `;

  const params = {
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: JD_SCHEMA,
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
    return response?.text ?? null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 429 && apiKey === GEMINI_API_KEY) {
      console.log("❌ Rate limit exceeded. Retrying with personal API key...");
      RPD_REACHED = true;
      return await callGemini(contextText, model);
    }
    console.error(`Error calling Gemini: ${e}`);
    return null;
  }
}
