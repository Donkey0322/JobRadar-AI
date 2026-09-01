import { CONFIG } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { AIProvider, AIResponse, GenerateOptions, Schema } from "./provider/utils";

import { AnthropicProvider } from "./provider/anthropic";
import { GoogleProvider } from "./provider/google";
import { OpenAIProvider } from "./provider/openai";

import { logger } from "@/utils/logger";

const AI_PROVIDER = CONFIG.ai.enabled ? CONFIG.ai.provider : "openai";
const DEFAULT_MODEL = CONFIG.ai.enabled ? CONFIG.ai.model : "gpt-4o";
export const AI_API_KEY = process.env.AI_API_KEY ?? "";
export const AI_DEFAULT_MODEL = DEFAULT_MODEL;

export function getProvider(apiKey: string): AIProvider | null {
  switch (AI_PROVIDER) {
    case "google":
      return new GoogleProvider(apiKey);

    case "anthropic":
      return new AnthropicProvider(apiKey);

    case "openai":
      return new OpenAIProvider(apiKey);

    default:
      AI_PROVIDER satisfies never;
      logger.error(`${RED_CROSS} Invalid AI provider: ${AI_PROVIDER}`);
      return null;
  }
}

export default async function callAIModel(
  prompt: string,
  schema: Schema,
  options?: GenerateOptions & { model?: string }
): Promise<AIResponse> {
  const model = options?.model ?? DEFAULT_MODEL;

  if (process.env.AI_MODE === "DOWN") {
    return { result: null, cost: 0 };
  }

  const provider = getProvider(AI_API_KEY);

  if (!provider) {
    return { result: null, cost: 0 };
  }

  try {
    return await provider.generate(prompt, schema, model, options);
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Error calling AI Model: ${model}`);
    return { result: null, cost: 0 };
  }
}

export function getAIProvider(): AIProvider | null {
  if (process.env.AI_MODE === "DOWN") {
    return null;
  }

  return getProvider(AI_API_KEY);
}
