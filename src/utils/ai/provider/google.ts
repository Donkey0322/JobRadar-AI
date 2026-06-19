import { GoogleGenAI } from "@google/genai";

import { RED_CROSS } from "@/constants/log";

import type { AIProvider, AIResponse, Schema } from "./utils";
import type { GenerateContentResponse } from "@google/genai";

import { withRetry } from "./utils";

import { logger } from "@/utils/logger";

export class GoogleProvider implements AIProvider {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  private calculateCost(response: GenerateContentResponse): number {
    const usage = response.usageMetadata;

    if (!usage) {
      return 0;
    }

    const inputTokens = usage.promptTokenCount ?? 0;
    const outputTokens = usage.candidatesTokenCount ?? 0;

    // TODO: adjust by model if you switch Gemini model.
    const priceIn = 0.3 / 1_000_000;
    const priceOut = 2.5 / 1_000_000;

    return inputTokens * priceIn + outputTokens * priceOut;
  }

  public async validateModel(model: string): Promise<void> {
    await this.client.models.get({ model });
  }

  async generate(prompt: string, schema: Schema, model: string): Promise<AIResponse> {
    try {
      const response = await withRetry(() =>
        this.client.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        })
      );

      return {
        result: response.text ?? null,
        cost: this.calculateCost(response),
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
