import OpenAI, { toFile } from "openai";

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

const PRICE_IN = 1.25 / 1_000_000;
const PRICE_OUT = 10 / 1_000_000;
export const OPENAI_BATCH_DISCOUNT = 0.5;

export function calculateOpenAICost(usage?: {
  input_tokens?: number;
  output_tokens?: number;
} | null): number {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;

  return inputTokens * PRICE_IN + outputTokens * PRICE_OUT;
}

function extractFunctionCall(response: OpenAI.Responses.Response | undefined): string | null {
  const functionCall = response?.output?.find(
    (item: OpenAI.Responses.ResponseOutputItem) => item.type === "function_call"
  );

  if (!functionCall || functionCall.type !== "function_call") {
    return null;
  }

  return functionCall.arguments ?? null;
}

interface OpenAIBatchLine {
  custom_id?: string;
  error?: { message?: string } | null;
  response?: {
    status_code?: number;
    body?: OpenAI.Responses.Response;
  };
}

export function parseOpenAIBatchOutput(text: string): BatchGenerateResult[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as OpenAIBatchLine;
      const key = parsed.custom_id ?? String(index);

      if (parsed.error?.message) {
        return { key, result: null, cost: 0, error: parsed.error.message };
      }

      if (parsed.response?.status_code && parsed.response.status_code >= 400) {
        return {
          key,
          result: null,
          cost: 0,
          error: `HTTP ${parsed.response.status_code}`,
        };
      }

      const body = parsed.response?.body;
      const result = extractFunctionCall(body);

      return {
        key,
        result,
        cost: calculateOpenAICost(body?.usage) * OPENAI_BATCH_DISCOUNT,
        error: result ? undefined : "OpenAI batch response did not contain function_call",
      };
    });
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  public async validateModel(model: string): Promise<void> {
    await this.client.models.retrieve(model);
  }

  async generate(
    prompt: string,
    schema: Schema,
    model: string,
    options?: GenerateOptions
  ): Promise<AIResponse> {
    try {
      const response = (await withRetry(() =>
        this.client.responses.create({
          model,
          stream: false,
          instructions: options?.systemInstruction,
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

      const result = extractFunctionCall(response);

      if (!result) {
        logger.error(`${RED_CROSS} OpenAI response did not contain function_call`);
      }

      return {
        result,
        cost: calculateOpenAICost(response.usage),
      };
    } catch (error) {
      logger.error({ err: error }, `${RED_CROSS} Error generating OpenAI response`);
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
      const jsonl = `${requests
        .map((request) =>
          JSON.stringify({
            custom_id: request.key,
            method: "POST",
            url: "/v1/responses",
            body: {
              model,
              stream: false,
              instructions: request.systemInstruction,
              input: request.prompt,
              tools: [
                {
                  type: "function",
                  strict: true,
                  name: "extract",
                  description: "Extract structured information from the input text.",
                  parameters: request.schema,
                },
              ],
              tool_choice: {
                type: "function",
                name: "extract",
              },
            },
          })
        )
        .join("\n")}\n`;

      const uploaded = await withRetry(async () =>
        this.client.files.create({
          file: await toFile(Buffer.from(jsonl), "jobradar-batch.jsonl"),
          purpose: "batch",
        })
      );

      const batch = await withRetry(() =>
        this.client.batches.create({
          input_file_id: uploaded.id,
          endpoint: "/v1/responses",
          completion_window: "24h",
        })
      );

      return { name: batch.id };
    } catch (error) {
      logger.error({ err: error }, `${RED_CROSS} Error submitting OpenAI batch job`);
      return null;
    }
  }

  async getBatch(name: string): Promise<BatchJobStatus> {
    try {
      const batch = await withRetry(() => this.client.batches.retrieve(name));

      if (
        batch.status === "failed" ||
        batch.status === "expired" ||
        batch.status === "cancelled"
      ) {
        return {
          state: "failed",
          error: batch.errors?.data?.[0]?.message ?? batch.status,
        };
      }

      if (batch.status !== "completed") {
        return { state: "pending" };
      }

      if (!batch.output_file_id) {
        return { state: "failed", error: "OpenAI batch completed without an output file" };
      }

      const content = await withRetry(() => this.client.files.content(batch.output_file_id!));
      const text = await content.text();

      return {
        state: "succeeded",
        results: parseOpenAIBatchOutput(text),
      };
    } catch (error) {
      logger.error({ err: error, name }, `${RED_CROSS} Error reading OpenAI batch job`);
      return { state: "pending" };
    }
  }
}
