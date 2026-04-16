import { ApiError, GoogleGenAI } from "@google/genai";

import type { GenerateContentResponse } from "@google/genai";

import { logger } from "@/utils/logger";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const PERSONAL_GEMINI_API_KEY = process.env.BACKUP_GEMINI_API_KEY ?? "";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface AIResponse {
  result: string | null;
  cost: number;
}

function calculateCost(response: GenerateContentResponse): number {
  const usage = response.usageMetadata;

  if (usage) {
    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;

    const priceIn = 0.3 / 1_000_000;
    const priceOut = 2.5 / 1_000_000;

    const cost = inputTokens * priceIn + outputTokens * priceOut;
    return cost;
  }
  return 0;
}

async function callGeminiWithRetry(fn: () => Promise<GenerateContentResponse>, retries = 5) {
  let delay = 2000;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fn();
      return response;
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        logger.warn("⚠️ Gemini is busy; retrying...");
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
  prompt: string,
  schema: object,
  model: string = DEFAULT_MODEL
): Promise<AIResponse> {
  if (!GEMINI_API_KEY) {
    logger.error("❌ GEMINI_API_KEY is not set");
    return { result: null, cost: 0 };
  }

  const params = {
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };

  const apiKey = RPD_REACHED ? PERSONAL_GEMINI_API_KEY : GEMINI_API_KEY;
  if (!apiKey) {
    logger.error("❌ API key is not set");
    return { result: null, cost: 0 };
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const fn = () => client.models.generateContent(params);
    const response = await callGeminiWithRetry(fn);
    return { result: response?.text ?? null, cost: calculateCost(response) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 429 && apiKey === GEMINI_API_KEY) {
      logger.warn("⚠️ Rate limit exceeded; retrying with personal API key");
      RPD_REACHED = true;
      return await callGemini(prompt, schema, model);
    }
    logger.error({ err: e }, "❌ Error calling Gemini");
    return { result: null, cost: 0 };
  }
}
