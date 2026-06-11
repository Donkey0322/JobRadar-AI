import type { Job } from "@/types";
import type { Country } from "@/validation/config";
import type { Season } from "@/validation/season";

import { getToday } from "@/utils/string";
import { JobCategory } from "@/validation/config";

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function locationIcon(location: Country) {
  switch (location) {
    case "USA":
      return "🇺🇸";

    case "Canada":
      return "🇨🇦";

    case "UK":
      return "🇬🇧";

    case "Germany":
      return "🇩🇪";

    case "Netherlands":
      return "🇳🇱";

    case "France":
      return "🇫🇷";

    case "Switzerland":
      return "🇨🇭";

    case "Sweden":
      return "🇸🇪";

    case "Denmark":
      return "🇩🇰";

    case "Norway":
      return "🇳🇴";

    case "Finland":
      return "🇫🇮";

    case "Ireland":
      return "🇮🇪";

    case "Poland":
      return "🇵🇱";

    case "Spain":
      return "🇪🇸";

    case "Italy":
      return "🇮🇹";

    case "Portugal":
      return "🇵🇹";

    case "Australia":
      return "🇦🇺";

    case "New Zealand":
      return "🇳🇿";

    case "Singapore":
      return "🇸🇬";

    case "Japan":
      return "🇯🇵";

    case "South Korea":
      return "🇰🇷";

    case "Taiwan":
      return "🇹🇼";

    case "Hong Kong":
      return "🇭🇰";

    case "India":
      return "🇮🇳";

    case "Remote":
      return "🌐";

    case "Other":
      return "🌎";

    case "Unsure":
      return "❓";

    default:
      location satisfies never;
      return "";
  }
}

function renderTags(citizenship: boolean | null, sponsorship: boolean | null) {
  const tags: string[] = [];

  if (citizenship === true) {
    tags.push(`
      <span style="
        display:inline-block;
        background:#fff4e5;
        color:#b26a00;
        border:1px solid #ffd59e;
        padding:4px 10px;
        border-radius:999px;
        font-size:12px;
        font-weight:600;
        margin-right:8px;
      ">
        🇺🇸 Citizen Only
      </span>
    `);
  }

  if (sponsorship === false) {
    tags.push(`
      <span style="
        display:inline-block;
        background:#fdecec;
        color:#c62828;
        border:1px solid #f5b5b5;
        padding:4px 10px;
        border-radius:999px;
        font-size:12px;
        font-weight:600;
        margin-right:8px;
      ">
        🛂 No Sponsorship
      </span>
    `);
  }

  return tags.join("");
}

function formTitle(category?: JobCategory, season?: Season) {
  switch (category) {
    case JobCategory.SUMMER_INTERN:
      return `${season} Intern`;

    case JobCategory.OFF_SEASON_INTERN:
      if (season === "None") {
        return "Off-Season Intern";
      }
      return `${season} Intern`;

    case JobCategory.ENTRY_LEVEL:
      return `Entry Level`;

    case JobCategory.MID_LEVEL:
      return `Mid Level`;

    case JobCategory.SENIOR_LEVEL:
      return `Senior Level`;

    default:
      category satisfies undefined;
      return "General";
  }
}

export function generateEmailContent(job: Job) {
  const { company, role, link, jd } = job;

  const citizenship = jd?.citizenship ?? null;
  const sponsorship = jd?.sponsorship ?? null;
  const country: Country = jd?.country ?? "Other";
  const category = jd?.category;
  const season: Season = jd?.season ?? "None";
  const qualifications: string[] = jd?.qualifications ?? [];

  const tagsHtml = renderTags(citizenship, sponsorship);

  const todayStr = getToday();
  const title = formTitle(category, season);

  const subject = `[${company}] ${role} — ${todayStr}`;

  const text = `Company: ${company}
Role: ${role}
Link: ${link}`;

  let html = `
  <html>
  <body style="font-family: Arial, sans-serif; color: #333; background-color: #fafafa; padding: 30px;">
    <table align="center" width="600" cellpadding="0" cellspacing="0"
      style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
      <tr>
        <td>

          <div style="display:flex;align-items:center;justify-content:space-between;">
            <h2 style="color:#1a73e8;margin:0;">
              ${escapeHtml(company)}
            </h2>

            <h2 style="transform:scale(1.1);margin:0;">
              ${locationIcon(country)}
            </h2>
          </div>

          <p style="font-size:16px;margin:8px 0 10px;">
            <b>Role:</b> ${escapeHtml(role)}
          </p>
  `;

  if (tagsHtml) {
    html += `
      <div style="margin:0 0 20px;">
        ${tagsHtml}
      </div>
    `;
  }

  if (qualifications.length > 0) {
    html += `
      <div style="
        background-color:#f7f9fc;
        border:1px solid #e3e8ef;
        border-radius:8px;
        padding:16px 20px;
        margin:20px 0;
      ">
        <p style="
          font-size:16px;
          font-weight:bold;
          margin:0 0 10px;
          color:#2b579a;
        ">
          Qualifications
        </p>

        <ul style="margin:0;padding-left:0;list-style:none;">
          ${qualifications
            .map(
              (qual) => `
                <li style="
                  margin-bottom:8px;
                  line-height:1.6;
                  display:flex;
                  align-items:flex-start;
                ">
                  <span style="
                    display:inline-block;
                    width:6px;
                    height:6px;
                    background-color:#2b579a;
                    border-radius:50%;
                    margin:10px;
                    flex-shrink:0;
                  "></span>

                  <span style="flex:1;">
                    ${escapeHtml(qual)}
                  </span>
                </li>
              `
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  html += `
          <a
            href="${link}"
            target="_blank"
            style="
              display:inline-block;
              padding:12px 22px;
              background-color:#1a73e8;
              color:white;
              text-decoration:none;
              border-radius:6px;
              font-weight:bold;
            "
          >
            Apply Now
          </a>

          <hr style="
            border:none;
            border-top:1px solid #eee;
            margin:28px 0;
          ">

          <p style="font-size:13px;color:#888;">
            Sent automatically on ${todayStr}
          </p>

        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  return {
    subject,
    html,
    text,
    title,
  };
}
