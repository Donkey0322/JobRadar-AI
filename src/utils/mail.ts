import nodemailer from "nodemailer";

import type { Job } from "@/types";

import { getToday } from "@/utils/string";

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendEmail(job: Job) {
  const { company, link, season, jd } = job;
  let { role } = job;

  const smtpHost = process.env.SMTP_HOST ?? "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT ?? "587");
  const smtpUser = process.env.SMTP_USER ?? "";
  const smtpPass = process.env.SMTP_PASS ?? "";
  const fromEmail = process.env.FROM_EMAIL ?? "";
  const toEmail = process.env.TO_EMAIL ?? "";

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromEmail || !toEmail) {
    throw new Error("Email env not fully configured, skip sending.");
  }

  const requiresUSA = jd?.citizenship ?? null;
  const sponsorship = jd?.sponsorship ?? null;
  const qualifications = jd?.qualifications ?? [];
  const term = season == "New Grad" ? "New Grad" : `${season} Intern`;

  if (requiresUSA === true) {
    role += " 🇺🇸";
  }

  if (sponsorship === false) {
    role += " 🛂";
  }

  const todayStr = getToday();
  const subject = `[${company}] ${role} — ${todayStr}`;

  const plainText = `Company: ${company}
Role: ${role}
Link: ${link}`;

  let htmlBody = `
  <html>
  <body style="font-family: Arial, sans-serif; color: #333; background-color: #fafafa; padding: 30px;">
    <table align="center" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      <tr><td>
        <h2 style="color:#1a73e8;margin:0;">${company}</h2>
        <p style="font-size:16px;margin:8px 0 20px;"><b>Role:</b> ${role}</p>
  `;

  if (qualifications.length > 0) {
    htmlBody += `
      <div style="background-color:#f7f9fc;border:1px solid #e3e8ef;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="font-size:16px;font-weight:bold;margin:0 0 10px;color:#2b579a;">Qualifications</p>
        <ul style="margin:0;padding-left:0;list-style:none;">
          ${qualifications
            .map(
              (qual) => `
              <li style="margin-bottom:8px;line-height:1.6;display:flex;align-items:flex-start;">
                <span style="display:inline-block;width:6px;height:6px;background-color:#2b579a;border-radius:50%;margin:10px;"></span>
                <span style="flex:1;">${escapeHtml(qual)}</span>
              </li>
            `
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  htmlBody += `
        <a href="${link}" target="_blank"
           style="display:inline-block;padding:12px 22px;background-color:#1a73e8;
                  color:white;text-decoration:none;border-radius:6px;font-weight:bold;">
           Apply Now
        </a>
        <hr style="border:none;border-top:1px solid #eee;margin:28px 0;">
        <p style="font-size:13px;color:#888;">Sent automatically on ${todayStr}</p>
      </td></tr>
    </table>
  </body>
  </html>
  `;

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
    text: plainText,
    html: htmlBody,
  });

  console.log(`✅ Sent email: ${company} | ${role}`);
}
