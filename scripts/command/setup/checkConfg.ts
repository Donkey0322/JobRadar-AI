import nodemailer from "nodemailer";

import "dotenv/config";
import { CONFIG } from "@/constants";
import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { getProvider } from "@/utils/ai";
import { logger } from "@/utils/logger";

export async function checkAIConfig() {
  try {
    if (!process.env.AI_API_KEY) {
      logger.warn(`${RED_CROSS} AI_API_KEY is not set, AI features will be disabled`);
      process.env.AI_MODE = "DOWN";
    } else {
      const provider = getProvider(process.env.AI_API_KEY);
      if (!provider) {
        logger.warn(`${RED_CROSS} Failed to get provider, AI features will be disabled`);
        process.env.AI_MODE = "DOWN";
      } else {
        await provider.validateModel(CONFIG.ai.model);
        logger.info(`${GREEN_CHECKMARK} AI config is valid`);
        process.env.AI_MODE = "ON";
      }
    }
  } catch {
    logger.error(`${RED_CROSS} Failed to check AI config, AI features will be disabled`);
    process.env.AI_MODE = "DOWN";
  }
}

export default async function checkConfig() {
  try {
    await checkAIConfig();

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
