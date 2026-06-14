import OpenAI from "openai";

import { RED_CROSS } from "@/constants/log";

import type { AIProvider, AIResponse, Schema } from "./utils";

import { withRetry } from "./utils";

import { logger } from "@/utils/logger";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  private calculateCost(response: OpenAI.Responses.Response): number {
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;

    // TODO: adjust by model.
    // Placeholder. Put your selected model's real pricing here.
    const priceIn = 1.25 / 1_000_000;
    const priceOut = 10 / 1_000_000;

    return inputTokens * priceIn + outputTokens * priceOut;
  }

  public async validateModel(model: string): Promise<void> {
    await this.client.models.retrieve(model);
  }

  async generate(prompt: string, schema: Schema, model: string): Promise<AIResponse> {
    const response = (await withRetry(() =>
      this.client.responses.create({
        model,
        stream: false,
        input: prompt,
        tools: [
          {
            type: "function",
            strict: true,
            name: "extract",
            description: "Extract structured information from the input text.",
            parameters: schema,
          },
        ],
        tool_choice: {
          type: "function",
          name: "extract",
        },
      })
    )) as OpenAI.Responses.Response;

    const functionCall = response.output.find(
      (item: OpenAI.Responses.ResponseOutputItem) => item.type === "function_call"
    );

    if (!functionCall || functionCall.type !== "function_call") {
      logger.error(`${RED_CROSS} OpenAI response did not contain function_call`);
      return {
        result: null,
        cost: this.calculateCost(response),
      };
    }

    return {
      result: functionCall.arguments ?? null,
      cost: this.calculateCost(response),
    };
  }
}
