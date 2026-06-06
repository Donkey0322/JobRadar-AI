import { JOB_CATEGORIES } from "@/constants";
import { COUNTRIES } from "@/constants";
import { RED_CROSS } from "@/constants/log";
import { SEASON_VALUES } from "@/constants/season";

import type { JD } from "@/types";
import type { AIResponse } from "@/utils/ai/provider/utils";

import { loadPrompt, toBulletList } from "./prompts/util";

import callAIModel from "@/utils/ai";
import { logger } from "@/utils/logger";

const JD_PROPERTIES: Record<keyof JD, unknown> = {
  citizenship: {
    type: ["boolean", "null"],
  },

  sponsorship: {
    type: ["boolean", "null"],
  },

  qualifications: {
    type: "array",
    items: {
      type: "string",
    },
  },

  country: {
    type: "string",
    enum: COUNTRIES,
  },

  category: {
    type: "string",
    enum: JOB_CATEGORIES,
  },

  season: {
    type: "string",
    enum: SEASON_VALUES,
  },
};

const JD_REQUIRED = [
  "citizenship",
  "sponsorship",
  "qualifications",
  "country",
  "category",
  "season",
] satisfies Array<keyof JD>;

const JD_SCHEMA = {
  type: "object",
  properties: JD_PROPERTIES,
  required: JD_REQUIRED,
  additionalProperties: false,
};

export default async function analyzeJD(context: string): Promise<AIResponse> {
  const prompt = await loadPrompt({
    CONTEXT: context,
    COUNTRIES: toBulletList(COUNTRIES),
    JOB_CATEGORIES: toBulletList(JOB_CATEGORIES),
    SEASONS: toBulletList(SEASON_VALUES),
  });
  try {
    const response = await callAIModel(prompt, JD_SCHEMA);
    return response ?? null;
  } catch (e) {
    logger.error({ err: e }, `${RED_CROSS} Error calling AI Model`);
    return { result: null, cost: 0 };
  }
}
