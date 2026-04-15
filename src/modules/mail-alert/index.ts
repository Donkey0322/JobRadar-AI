import nodemailer from "nodemailer";

import type { Job, Location } from "@/types";

import { CONFIG } from "@/constants";
import { getToday } from "@/utils/string";

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function locationIcon(location: Location) {
  switch (location) {
    case "USA":
      return "";
    case "Canada":
      return "🇨🇦";
    case "UK":
      return "🇬🇧";
    case "Other":
      return "🌎";
    default:
      return "";
  }
}

function toTerm(season: Job["season"]) {
  switch (season) {
    case undefined:
    case "unsure":
      return "Intern";
    case "New Grad":
      return "New Grad";
    default:
      return `${season} Intern`;
  }
}

export async function sendEmail(job: Job) {
  const { company, link, season, jd } = job;
  let { role } = job;

  const smtpHost = CONFIG.sender.host;
  const smtpPort = CONFIG.sender.port;
  const smtpUser = CONFIG.sender.user;
  const smtpPass = CONFIG.sender.pass;
  const fromEmail = CONFIG.sender.email;
  const toEmail = CONFIG.receiver.email;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromEmail || !toEmail) {
    throw new Error("Email env not fully configured, skip sending.");
  }

  const requiresUSA = jd?.citizenship ?? null;
  const sponsorship = jd?.sponsorship ?? null;
  const location = jd?.location ?? "Other";
  const qualifications = jd?.qualifications ?? [];

  const term = toTerm(season);

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
        <div style="display: flex; align-items: center; justify-content: space-between">
            <h2 style="color: #1a73e8; margin: 0">${company}</h2>
            <h2 style="transform: scale(1.1); margin: 0">${locationIcon(location)}</h2>
        </div>
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
