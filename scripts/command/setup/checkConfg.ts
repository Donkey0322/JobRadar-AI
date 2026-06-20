import nodemailer from "nodemailer";

import "dotenv/config";
import { CONFIG } from "@/constants";
import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { getProvider } from "@/utils/ai";
import { logger } from "@/utils/logger";

export async function checkAIConfig() {
  process.env.AI_MODE = "DOWN";
  try {
    if (!CONFIG.ai.enabled) {
      return true;
    }
    if (!process.env.AI_API_KEY) {
      logger.error(`${RED_CROSS} AI_API_KEY is not set, AI features will be disabled`);
      return false;
    }

    const provider = getProvider(process.env.AI_API_KEY);
    if (!provider) {
      logger.error(`${RED_CROSS} Failed to get provider, AI features will be disabled`);
      return false;
    }

    await provider.validateModel(CONFIG.ai.model);
    logger.info(`${GREEN_CHECKMARK} AI config is valid`);
    process.env.AI_MODE = "ON";
    return true;
  } catch (error) {
    logger.error({ error }, `${RED_CROSS} Failed to check AI config, AI features will be disabled`);
    return false;
  }
}

export default async function checkConfig() {
  try {
    const aiConfigValid = await checkAIConfig();
    if (!aiConfigValid) {
      process.exit(1);
    }

    // validate sender config
    const mailer = nodemailer.createTransport({
      host: CONFIG.sender.host,
      port: CONFIG.sender.port,
      secure: CONFIG.sender.port === 465,
      auth: {
        user: CONFIG.sender.user,
        pass: CONFIG.sender.pass,
      },
    });

    await mailer.verify();
    logger.info(`${GREEN_CHECKMARK} SMTP config is valid`);
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Failed to check config`);
    process.exit(1);
  }
}
