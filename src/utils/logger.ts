import { pino } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

const usePretty =
  process.env.LOG_PRETTY === "1" || (process.env.LOG_PRETTY !== "0" && process.stdout.isTTY);

export const logger = usePretty
  ? pino({
      level,
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    })
  : pino({ level });
