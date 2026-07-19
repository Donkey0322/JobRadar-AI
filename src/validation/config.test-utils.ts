import { type Config, JobCategory } from "./config";

export function createValidConfig(overrides: Partial<Config> = {}): Config {
  return {
    target: {
      intern: [JobCategory.SUMMER_INTERN],
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
      email: "receiver@example.com",
    },
    ...overrides,
  };
}
