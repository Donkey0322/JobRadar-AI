import type { Country } from "@/constants/country";

import { type Config, ConfigSchema } from "./schema";

export type LoadedConfig = Config & { sender: { pass: string } };

export function loadConfig(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env
): { CONFIG: LoadedConfig; ALLOWED_COUNTRIES: Set<Country> } {
  const parsedConfig = ConfigSchema.parse(raw);

  const CONFIG: LoadedConfig = {
    target: parsedConfig.target,
    dashboard: parsedConfig.dashboard,
    ai: parsedConfig.ai,
    sender: {
      host: parsedConfig.sender.host,
      port: Number(parsedConfig.sender.port),
      user: parsedConfig.sender.user,
      pass: env.SMTP_PASS ?? "",
      email: parsedConfig.sender.email,
    },
    receiver: parsedConfig.receiver,
  };

  const ALLOWED_COUNTRIES =
    CONFIG.target.countries.length > 0
      ? new Set<Country>([...CONFIG.target.countries, "Unsure"])
      : new Set<Country>([]);

  return { CONFIG, ALLOWED_COUNTRIES };
}
