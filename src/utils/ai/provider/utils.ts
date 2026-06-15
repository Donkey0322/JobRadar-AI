import { ApiError } from "@google/genai";

import { CONFIG } from "@/constants";

import { logger } from "@/utils/logger";

const AI_PROVIDER = CONFIG.ai.provider;

export interface AIResponse {
  result: string | null;
  cost: number;
}

export interface Schema extends Record<string, unknown> {
  type: string;
}

export interface AIProvider {
  generate(prompt: string, schema: Record<string, unknown>, model: string): Promise<AIResponse>;
  validateModel(model: string): Promise<void>;
}

type RetryableFn<T> = () => Promise<T>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 429 || error.status === 500 || error.status === 503;
  }

  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return status === 429 || status === 500 || status === 503;
  }

  return false;
}

export async function withRetry<T>(fn: RetryableFn<T>, retries = 5): Promise<T> {
  // minimum delay of 1 minute
  let delay = 1000;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (isRetryableError(error) && i < retries - 1) {
        logger.warn({ err: error }, `⚠️ ${AI_PROVIDER} is busy; retrying...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      throw error;
    }
  }

  throw new Error(`${AI_PROVIDER} failed after retries`);
}
