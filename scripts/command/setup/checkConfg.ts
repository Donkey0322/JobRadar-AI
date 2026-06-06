import nodemailer from "nodemailer";

import "dotenv/config";
import { CONFIG } from "@/constants";
import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { getProvider } from "@/utils/ai";
import { logger } from "@/utils/logger";

export default async function checkConfig() {
  try {
    if (!process.env.AI_API_KEY) {
      throw new Error("AI_API_KEY is not set");
    }

    const provider = getProvider(process.env.AI_API_KEY);
    if (!provider) {
      throw new Error("Failed to get provider");
    }

    await provider.validateModel(CONFIG.ai.model);
    logger.info(
      `${GREEN_CHECKMARK} Config is valid for ${CONFIG.ai.provider} model: ${CONFIG.ai.model}, API key validated!!`
    );

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
    logger.info(`${GREEN_CHECKMARK} Sender config is valid`);
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Failed to check config`);
    process.exit(1);
  }
}
