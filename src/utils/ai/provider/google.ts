import { GoogleGenAI, JobState } from "@google/genai";

import { RED_CROSS } from "@/constants/log";

import type {
  AIProvider,
  AIResponse,
  BatchGenerateRequest,
  BatchJobStatus,
  GenerateOptions,
  Schema,
} from "./utils";
import type { GenerateContentResponse } from "@google/genai";

import { withRetry } from "./utils";

import { logger } from "@/utils/logger";

const PRICE_IN = 0.3 / 1_000_000;
const PRICE_CACHED = 0.03 / 1_000_000;
const PRICE_OUT = 2.5 / 1_000_000;
export const GOOGLE_BATCH_DISCOUNT = 0.5;
export function googleBatchDurationMs(
  createTime: string | undefined,
  endTime: string | undefined
) {
  const start = createTime ? Date.parse(createTime) : Number.NaN;
  const end = endTime ? Date.parse(endTime) : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return undefined;
  }

  return Math.max(0, end - start);
}

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

  async submitBatch(
    requests: BatchGenerateRequest[],
    model: string
  ): Promise<{ name: string } | null> {
    try {
      const job = await withRetry(() =>
        this.client.batches.create({
          model,
          src: requests.map((request) => ({
            contents: request.prompt,
            metadata: { key: request.key },
            config: {
              responseMimeType: "application/json",
              responseSchema: request.schema,
              systemInstruction: request.systemInstruction,
              thinkingConfig: thinkingConfigFor(model),
            },
          })),
          config: {
            displayName: `jobradar-jd-${Date.now()}`,
          },
        })
      );

      if (!job.name) {
        logger.error(`${RED_CROSS} Google batch job was created without a name`);
        return null;
      }

      return { name: job.name };
    } catch (error) {
      logger.error({ err: error }, `${RED_CROSS} Error submitting Google batch job`);
      return null;
    }
  }

  async getBatch(name: string): Promise<BatchJobStatus> {
    try {
      const job = await withRetry(() => this.client.batches.get({ name }));
      const state = job.state;

      if (state === JobState.JOB_STATE_SUCCEEDED) {
        const responses = job.dest?.inlinedResponses ?? [];

        return {
          state: "succeeded",
          durationMs: googleBatchDurationMs(job.createTime, job.endTime),
          results: responses.map((item, index) => ({
            key: item.metadata?.key ?? String(index),
            result: item.response?.text ?? null,
            cost: calculateGoogleCost(item.response?.usageMetadata) * GOOGLE_BATCH_DISCOUNT,
            error: item.error?.message,
          })),
        };
      }

      if (
        state === JobState.JOB_STATE_FAILED ||
        state === JobState.JOB_STATE_CANCELLED ||
        state === JobState.JOB_STATE_EXPIRED
      ) {
        return {
          state: "failed",
          error: job.error?.message ?? String(state),
        };
      }

      return { state: "pending" };
    } catch (error) {
      logger.error({ err: error, name }, `${RED_CROSS} Error reading Google batch job`);
      return { state: "pending" };
    }
  }
}
