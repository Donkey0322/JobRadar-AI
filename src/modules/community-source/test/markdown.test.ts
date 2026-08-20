import { describe, expect, it } from "vitest";

import parseMarkdown from "../markdown";

const TODAY = "Aug 20";

function markdownTable(headers: string[], rows: string[][]) {
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((cols) => `| ${cols.join(" | ")} |`).join("\n");

  return `${header}\n${separator}\n${body}\n`;
}

describe("parseMarkdown", () => {
  it("parses summer tables without a Terms column", () => {
    const md = markdownTable(
      ["Company", "Role", "Location", "Application/Link", "Date Posted"],
      [
        [
          "TikTok",
          "Software Engineer Intern",
          "San Jose, CA",
          '<a href="https://example.com/tiktok?utm_source=github-vansh-ouckah">Apply</a>',
          TODAY,
        ],
        [
          "↳",
          "Backend Intern",
          "Seattle, WA",
          '<a href="https://example.com/tiktok-backend">Apply</a>',
          TODAY,
        ],
      ]
    );

    expect(parseMarkdown(md, TODAY)).toEqual([
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
    const md = markdownTable(
      ["Company", "Role", "Location", "Terms", "Application/Link", "Date Posted"],
      [
        [
          "Shopify",
          "Software Engineering Intern",
          "Remote",
          "Winter 2027",
          '<a href="https://www.shopify.com/careers/intern">Apply</a>',
          TODAY,
        ],
      ]
    );

    expect(parseMarkdown(md, TODAY)).toEqual([
      {
        company: "Shopify",
        role: "Software Engineering Intern",
        location: "Remote",
        link: "https://www.shopify.com/careers/intern",
      },
    ]);
  });

  it("parses every markdown table, not only the first", () => {
    const md = [
      markdownTable(
        ["Company", "Role", "Location", "Application/Link", "Date Posted"],
        [
          [
            "TikTok",
            "Software Engineer Intern",
            "San Jose, CA",
            '<a href="https://example.com/swe">Apply</a>',
            TODAY,
          ],
        ]
      ),
      markdownTable(
        ["Company", "Role", "Location", "Application/Link", "Date Posted"],
        [
          [
            "Stripe",
            "Product Manager Intern",
            "SF",
            '<a href="https://example.com/pm">Apply</a>',
            TODAY,
          ],
        ]
      ),
    ].join("\n## Another list\n\n");

    expect(parseMarkdown(md, TODAY).map((job) => job.role)).toEqual([
      "Software Engineer Intern",
      "Product Manager Intern",
    ]);
  });

  it("skips header, separator, closed, and non-today rows", () => {
    const md = `
| Company | Role | Location | Application/Link | Date Posted |
| ------- | ---- | -------- | ---------------- | ----------- |
| Old Co | Software Engineer Intern | NYC | <a href="https://example.com/old">Apply</a> | Aug 19 |
| Closed Co | Software Engineer Intern | NYC | 🔒 | ${TODAY} |
| **Quora** | New Grad: Software Engineer | Remote | <a href="https://example.com/quora">Apply</a> | ${TODAY} |
`;

    expect(parseMarkdown(md, TODAY)).toEqual([
      {
        company: "Quora",
        role: "New Grad: Software Engineer",
        location: "Remote",
        link: "https://example.com/quora",
      },
    ]);
  });
});
