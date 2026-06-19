import Anthropic from "@anthropic-ai/sdk";

import { RED_CROSS } from "@/constants/log";

import type { AIProvider, AIResponse, Schema } from "./utils";

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

  private normalizeSchema(schema: Schema): { schema: Anthropic.Tool.InputSchema; wrap: boolean } {
    if (schema.type === "object") {
      return {
        schema: {
          ...schema,
          type: "object",
        },
        wrap: false,
      };
    }

    return {
      schema: {
        type: "object",
        properties: {
          result: schema,
        },
        required: ["result"],
      },
      wrap: true,
    };
  }

  private parseResult(result: unknown, wrapped: boolean): unknown {
    if (wrapped && result && typeof result === "object" && "result" in result) {
      return (result as { result: unknown }).result;
    }
    return result;
  }

  async generate(prompt: string, schema: Schema, model: string): Promise<AIResponse> {
    try {
      const { schema: normalizedSchema, wrap } = this.normalizeSchema(schema);

      const response = await withRetry(() =>
        this.client.messages.create({
          model,
          temperature: 0,
          max_tokens: 4096,
          tools: [
            {
              name: "extract" as const,
              description: "Extract structured information from the input text.",
              input_schema: normalizedSchema,
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
        result: stringifyResult(this.parseResult(toolUse.input, wrap)),
        cost: this.calculateCost(response),
      };
    } catch (error) {
      logger.error({ err: error }, `${RED_CROSS} Error generating Anthropic response`);
      return {
        result: null,
        cost: 0,
      };
    }
  }
}
