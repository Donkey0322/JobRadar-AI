import nodemailer from "nodemailer";

import "dotenv/config";
import { CONFIG } from "@/constants";
import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { getProvider } from "@/utils/ai";
import { logger } from "@/utils/logger";

export async function checkAIConfig(): Promise<boolean> {
  process.env.AI_MODE = "DOWN";

  try {
    if (!CONFIG.ai.enabled) {
      logger.info(`${GREEN_CHECKMARK} AI is disabled, skipping AI config check`);
      return true;
    }

    if (!process.env.AI_API_KEY) {
      logger.error(`${RED_CROSS} AI_API_KEY is not set`);
      return false;
    }

    const provider = getProvider(process.env.AI_API_KEY);

    if (!provider) {
      logger.error(`${RED_CROSS} Failed to initialize AI provider`);
      return false;
    }

    await provider.validateModel(CONFIG.ai.model);

    process.env.AI_MODE = "ON";
    logger.info(`${GREEN_CHECKMARK} AI config is valid`);

    return true;
  } catch (error) {
    logger.error({ error }, `${RED_CROSS} Failed to check AI config`);
    return false;
  }
}

export async function checkSMTPConfig(): Promise<boolean> {
  try {
    if (!CONFIG.sender.host) {
      logger.error(`${RED_CROSS} sender.host is not set`);
      return false;
    }

    if (!CONFIG.sender.port || Number.isNaN(Number(CONFIG.sender.port))) {
      logger.error(`${RED_CROSS} sender.port is invalid`);
      return false;
    }

    if (!CONFIG.sender.user) {
      logger.error(`${RED_CROSS} sender.user is not set`);
      return false;
    }

    if (!CONFIG.sender.email) {
      logger.error(`${RED_CROSS} sender.email is not set`);
      return false;
    }

    if (!CONFIG.receiver.email) {
      logger.error(`${RED_CROSS} receiver.email is not set`);
      return false;
    }

    if (!CONFIG.sender.pass) {
      logger.error(`${RED_CROSS} SMTP_PASS is not set`);
      return false;
    }

    const mailer = nodemailer.createTransport({
      host: CONFIG.sender.host,
      port: Number(CONFIG.sender.port),
      secure: Number(CONFIG.sender.port) === 465,
      auth: {
        user: CONFIG.sender.user,
        pass: CONFIG.sender.pass,
      },
    });

    await mailer.verify();

    logger.info(`${GREEN_CHECKMARK} SMTP config is valid`);

    return true;
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Failed to check SMTP config`);
    return false;
  }
}

export function checkGitHubConfig(): boolean {
  if (!process.env.PAT) {
    logger.error(`${RED_CROSS} PAT is not set`);
    return false;
  }

  logger.info(`${GREEN_CHECKMARK} GitHub PAT is configured`);

  return true;
}

export default async function checkConfig(): Promise<void> {
  const aiConfigValid = await checkAIConfig();
  const smtpConfigValid = await checkSMTPConfig();
  const githubConfigValid = checkGitHubConfig();

  if (!aiConfigValid || !smtpConfigValid || !githubConfigValid) {
    logger.error(`${RED_CROSS} Config check failed`);
    process.exit(1);
  }

  logger.info(`${GREEN_CHECKMARK} All config checks passed`);
}
