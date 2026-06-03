import { CONFIG } from "@/constants";

import type { Job } from "@/types";
import type { Transporter } from "nodemailer";

import { generateEmailContent } from "./generate";

import { logger } from "@/utils/logger";

export async function sendEmail(job: Job, mailer: Transporter) {
  const fromEmail = CONFIG.sender.email;
  const toEmail = CONFIG.receiver.email;

  const { subject, html, text, term } = generateEmailContent(job);

  await mailer.sendMail({
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
