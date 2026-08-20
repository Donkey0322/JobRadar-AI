import { GoogleGenAI } from "@google/genai";

import { RED_CROSS } from "@/constants/log";

import type { AIProvider, AIResponse, GenerateOptions, Schema } from "./utils";
import type { GenerateContentResponse } from "@google/genai";

import { withRetry } from "./utils";

import { logger } from "@/utils/logger";

const PRICE_IN = 0.3 / 1_000_000;
const PRICE_CACHED = 0.03 / 1_000_000;
const PRICE_OUT = 2.5 / 1_000_000;

export function calculateGoogleCost(
  usage: GenerateContentResponse["usageMetadata"] | undefined
): number {
  if (!usage) {
    return 0;
  }

  const promptTokens = usage.promptTokenCount ?? 0;
  const cachedTokens = usage.cachedContentTokenCount ?? 0;
  const uncachedInputTokens = Math.max(promptTokens - cachedTokens, 0);
  const outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);

  return uncachedInputTokens * PRICE_IN + cachedTokens * PRICE_CACHED + outputTokens * PRICE_OUT;
}

function thinkingConfigFor(model: string) {
  if (!/flash/i.test(model)) {
    return undefined;
  }

  return { thinkingBudget: 0 };
}

export class GoogleProvider implements AIProvider {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  public async validateModel(model: string): Promise<void> {
    await this.client.models.get({ model });
  }

  async generate(
    prompt: string,
    schema: Schema,
    model: string,
    options?: GenerateOptions
  ): Promise<AIResponse> {
    try {
      const response = await withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            systemInstruction: options?.systemInstruction,
            thinkingConfig: thinkingConfigFor(model),
          },
        })
      );

      return {
        result: response.text ?? null,
        cost: calculateGoogleCost(response.usageMetadata),
      };
    } catch (error) {
      logger.error({ err: error }, `${RED_CROSS} Error generating Google response`);
      return {
        result: null,
        cost: 0,
      };
    }
  }
}
