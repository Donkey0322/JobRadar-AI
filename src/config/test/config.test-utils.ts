import type { Config } from "../schema";

export function createValidConfig(overrides: Partial<Config> = {}): Config {
  return {
    target: {
      intern: ["summer intern"],
      countries: ["USA"],
    },
    ai: {
      enabled: true,
      provider: "openai",
      model: "gpt-4o",
    },
    sender: {
      host: "smtp.gmail.com",
      port: 587,
      user: "test",
      email: "test@example.com",
    },
    receiver: {
      emails: ["receiver@example.com"],
    },
    ...overrides,
  };
}
