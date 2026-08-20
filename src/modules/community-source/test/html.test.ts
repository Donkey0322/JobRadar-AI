import { describe, expect, it } from "vitest";

import parseHtml from "../html";

function tablePage(heading: string, headers: string[], rows: string[][]) {
  const headerCells = headers.map((header) => `<th>${header}</th>`).join("");
  const body = rows
    .map(
      (cols) =>
        `<tr>${cols.map((col) => `<td>${col}</td>`).join("")}</tr>`
    )
    .join("");

  return `
## ${heading}

<table>
<thead><tr>${headerCells}</tr></thead>
<tbody>${body}</tbody>
</table>
`;
}

describe("parseHtml", () => {
  it("parses summer tables without a Terms column", () => {
    const html = tablePage(
      "💻 Software Engineering Internship Roles",
      ["Company", "Role", "Location", "Application", "Age"],
      [
        [
          "TikTok",
          "Software Engineer Intern",
          "San Jose, CA",
          '<a href="https://example.com/tiktok?utm_source=Simplify">Apply</a>',
          "0d",
        ],
        [
          "↳",
          "Backend Intern",
          "Seattle, WA",
          '<a href="https://example.com/tiktok-backend">Apply</a>',
          "0d",
        ],
      ]
    );

    expect(parseHtml(html)).toEqual([
      {
        company: "TikTok",
        role: "Software Engineer Intern",
        location: "San Jose, CA",
        link: "https://example.com/tiktok",
      },
      {
        company: "TikTok",
        role: "Backend Intern",
        location: "Seattle, WA",
        link: "https://example.com/tiktok-backend",
      },
    ]);
  });

  it("parses off-season tables with a Terms column", () => {
    const html = tablePage(
      "Software Engineering Internship Roles",
      ["Company", "Role", "Location", "Terms", "Application", "Age"],
      [
        [
          "Abundant",
          "Member of Technical Staff Intern - Research",
          "SF",
          "Winter 2027",
          '<a href="https://jobs.ashbyhq.com/abundant/abc">Apply</a>',
          "0d",
        ],
      ]
    );

    expect(parseHtml(html)).toEqual([
      {
        company: "Abundant",
        role: "Member of Technical Staff Intern - Research",
        location: "SF",
        link: "https://jobs.ashbyhq.com/abundant/abc",
      },
    ]);
  });

  it("parses every role table, not only software engineering", () => {
    const html = [
      tablePage(
        "💻 Software Engineering Internship Roles",
        ["Company", "Role", "Location", "Application", "Age"],
        [
          [
            "TikTok",
            "Software Engineer Intern",
            "San Jose, CA",
            '<a href="https://example.com/swe">Apply</a>',
            "0d",
          ],
        ]
      ),
      tablePage(
        "📱 Product Management Internship Roles",
        ["Company", "Role", "Location", "Application", "Age"],
        [
          [
            "Stripe",
            "Product Manager Intern",
            "SF",
            '<a href="https://example.com/pm">Apply</a>',
            "0d",
          ],
        ]
      ),
      tablePage(
        "🤖 Data Science, AI & Machine Learning Internship Roles",
        ["Company", "Role", "Location", "Application", "Age"],
        [
          [
            "OpenAI",
            "Machine Learning Engineer Intern",
            "SF",
            '<a href="https://example.com/ml">Apply</a>',
            "0d",
          ],
        ]
      ),
    ].join("\n");

    expect(parseHtml(html).map((job) => job.role)).toEqual([
      "Software Engineer Intern",
      "Product Manager Intern",
      "Machine Learning Engineer Intern",
    ]);
  });
});
