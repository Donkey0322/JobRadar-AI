import nodemailer from "nodemailer";

export interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface SMTPTransportOptions {
  pooled?: boolean;
}

export function createSMTPTransport(
  config: SMTPConfig,
  { pooled = false }: SMTPTransportOptions = {}
) {
  return nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: Number(config.port) === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    ...(pooled
      ? {
          pool: true,
          maxConnections: 1,
          maxMessages: Infinity,
        }
      : {}),
  });
}
