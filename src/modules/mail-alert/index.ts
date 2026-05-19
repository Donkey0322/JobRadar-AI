import nodemailer from "nodemailer";

import { CONFIG } from "@/constants";

import type { Job } from "@/types";

import { generateEmailContent } from "./generate";

import { logger } from "@/utils/logger";

export async function sendEmail(job: Job) {
  const smtpHost = CONFIG.sender.host;
  const smtpPort = CONFIG.sender.port;
  const smtpUser = CONFIG.sender.user;
  const smtpPass = CONFIG.sender.pass;
  const fromEmail = CONFIG.sender.email;
  const toEmail = CONFIG.receiver.email;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromEmail || !toEmail) {
    throw new Error("Email env not fully configured.");
  }

  const { subject, html, text, term } = generateEmailContent(job);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: `${term} <${fromEmail}>`,
    to: toEmail,
    subject,
    text,
    html,
  });

  logger.info(
    {
      company: job.company,
      role: job.role,
    },
    "✉️ Sent email"
  );
}
