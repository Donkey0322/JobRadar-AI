import "dotenv/config";

import config from "../../config.json";

import { loadConfig } from "./load";

export const { CONFIG, ALLOWED_COUNTRIES } = loadConfig(config);

export { loadConfig } from "./load";
export { ConfigSchema, type Config, type Country } from "./schema";
