import { CONFIG } from "@/constants";

import type { Job } from "@/types";
import type { Transporter } from "nodemailer";

import { generateEmailContent } from "./generate";

import { logger } from "@/utils/logger";

export async function sendEmail(job: Job, mailer: Transporter) {
  const fromEmail = CONFIG.sender.email;
  const toEmail = CONFIG.receiver.email;

  const { subject, html, text, title } = generateEmailContent(job);

  await mailer.sendMail({
    from: `${title} <${fromEmail}>`,
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
