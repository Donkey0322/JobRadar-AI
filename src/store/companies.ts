import { promises as fs } from "node:fs";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/types";

import { readJsonFile } from "@/store/json";
import { COMPANY_PATH } from "@/store/paths";
import { logger } from "@/utils/logger";

export async function loadCompanies(): Promise<Company[]> {
  try {
    return await readJsonFile<Company[]>(COMPANY_PATH);
  } catch {
    return [];
  }
}

export async function saveCompanies(companies: Company[]) {
  try {
    await fs.writeFile(COMPANY_PATH, JSON.stringify(companies, null, 2), "utf-8");
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Error saving companies`);
  }
}

export const companies = {
  load: loadCompanies,
  save: saveCompanies,
};
