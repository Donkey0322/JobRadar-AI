import Anthropic from "@anthropic-ai/sdk";

import { RED_CROSS } from "@/constants/log";

import type {
  AIProvider,
  AIResponse,
  BatchGenerateRequest,
  BatchGenerateResult,
  BatchJobStatus,
  GenerateOptions,
  Schema,
} from "./utils";

import { withRetry } from "./utils";

import { logger } from "@/utils/logger";
import { stringifyResult } from "@/utils/string";

const PRICE_IN = 3 / 1_000_000;
const PRICE_OUT = 15 / 1_000_000;
export const ANTHROPIC_BATCH_DISCOUNT = 0.5;

export function calculateAnthropicCost(usage?: {
  input_tokens?: number;
  output_tokens?: number;
} | null): number {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return inputTokens * PRICE_IN + outputTokens * PRICE_OUT;
}

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey: apiKey });
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

  private extractToolResult(
    message: { content: Array<{ type: string; input?: unknown }> },
    wrap: boolean
  ): string | null {
    const toolUse = message.content.find((block) => block.type === "tool_use");

    if (!toolUse || !("input" in toolUse)) {
      return null;
    }

    return stringifyResult(this.parseResult(toolUse.input, wrap));
  }

  parseBatchItem(
    item: {
      custom_id: string;
      result:
        | {
            type: "succeeded";
            message: {
              content: Array<{ type: string; input?: unknown }>;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
          }
        | { type: "errored"; error: { error: { message: string } } }
        | { type: "canceled" | "expired" };
    },
    wrap: boolean
  ): BatchGenerateResult {
    if (item.result.type === "succeeded") {
      const result = this.extractToolResult(item.result.message, wrap);

      return {
        key: item.custom_id,
        result,
        cost: calculateAnthropicCost(item.result.message.usage) * ANTHROPIC_BATCH_DISCOUNT,
        error: result ? undefined : "Anthropic batch response did not contain tool_use",
      };
    }

    if (item.result.type === "errored") {
      return {
        key: item.custom_id,
        result: null,
        cost: 0,
        error: item.result.error.error.message,
      };
    }

    return {
      key: item.custom_id,
      result: null,
      cost: 0,
      error: item.result.type,
    };
  }

  async generate(
    prompt: string,
    schema: Schema,
    model: string,
    options?: GenerateOptions
  ): Promise<AIResponse> {
    try {
      const { schema: normalizedSchema, wrap } = this.normalizeSchema(schema);

      const response = await withRetry(() =>
        this.client.messages.create({
          model,
          temperature: 0,
          max_tokens: 4096,
          system: options?.systemInstruction,
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

      const result = this.extractToolResult(response, wrap);

      if (!result) {
        logger.error(`${RED_CROSS} Anthropic response did not contain tool_use`);
      }

      return {
        result,
        cost: calculateAnthropicCost(response.usage),
      };
    } catch (error) {
      logger.error({ err: error }, `${RED_CROSS} Error generating Anthropic response`);
      return {
        result: null,
        cost: 0,
      };
    }
  }

  async submitBatch(
    requests: BatchGenerateRequest[],
    model: string
  ): Promise<{ name: string } | null> {
    try {
      const batch = await withRetry(() =>
        this.client.messages.batches.create({
          requests: requests.map((request) => {
            const { schema } = this.normalizeSchema(request.schema);

            return {
              custom_id: request.key,
              params: {
                model,
                temperature: 0,
                max_tokens: 4096,
                system: request.systemInstruction,
                tools: [
                  {
                    name: "extract" as const,
                    description: "Extract structured information from the input text.",
                    input_schema: schema,
                  },
                ],
                tool_choice: {
                  type: "tool" as const,
                  name: "extract",
                },
                messages: [
                  {
                    role: "user" as const,
                    content: request.prompt,
                  },
                ],
              },
            };
          }),
        })
      );

      return { name: batch.id };
    } catch (error) {
      logger.error({ err: error }, `${RED_CROSS} Error submitting Anthropic batch job`);
      return null;
    }
  }

  async getBatch(name: string): Promise<BatchJobStatus> {
    try {
      const batch = await withRetry(() => this.client.messages.batches.retrieve(name));

      if (batch.processing_status !== "ended") {
        return { state: "pending" };
      }

      const decoder = await this.client.messages.batches.results(name);
      const results: BatchGenerateResult[] = [];

      for await (const item of decoder) {
        results.push(this.parseBatchItem(item, false));
      }

      return { state: "succeeded", results };
    } catch (error) {
      logger.error({ err: error, name }, `${RED_CROSS} Error reading Anthropic batch job`);
      return { state: "pending" };
    }
  }
}
