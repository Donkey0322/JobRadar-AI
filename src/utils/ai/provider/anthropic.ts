import Anthropic from "@anthropic-ai/sdk";

import { RED_CROSS } from "@/constants/log";

import type { AIProvider, AIResponse } from "./utils";

import { withRetry } from "./utils";

import { logger } from "@/utils/logger";
import { stringifyResult } from "@/utils/string";

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey: apiKey });
  }

  private calculateCost(response: Anthropic.Messages.Message): number {
    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;

    // TODO: adjust by model.
    // Placeholder for Claude Sonnet-style pricing.
    const priceIn = 3 / 1_000_000;
    const priceOut = 15 / 1_000_000;

    return inputTokens * priceIn + outputTokens * priceOut;
  }

  public async validateModel(model: string): Promise<void> {
    await this.client.models.retrieve(model);
  }

  async generate(
    prompt: string,
    schema: Record<string, unknown>,
    model: string
  ): Promise<AIResponse> {
    const response = await withRetry(() =>
      this.client.messages.create({
        model: model,
        temperature: 0,
        max_tokens: 4096,
        tools: [
          {
            name: "extract" as const,
            description: "Extract structured information from the input text.",
            input_schema: schema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: {
          type: "tool",
          name: "extract",
        },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      })
    );

    const toolUse = response.content.find((block) => block.type === "tool_use");

    if (!toolUse || toolUse.type !== "tool_use") {
      logger.error(`${RED_CROSS} Anthropic response did not contain tool_use`);
      return {
        result: null,
        cost: this.calculateCost(response),
      };
    }

    return {
      result: stringifyResult(toolUse.input),
      cost: this.calculateCost(response),
    };
  }
}
