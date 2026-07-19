import { escapeRegExp } from "@/utils/url";

type IssueSectionParserOptions = {
  caseSensitive?: boolean;
};

type RequiredMessage = string | ((title: string) => string);

const NO_RESPONSE = "_No response_";

function removeComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, "");
}

export function createIssueSectionParser(body: string, options: IssueSectionParserOptions = {}) {
  const flags = options.caseSensitive === false ? "i" : "";

  function section(title: string): string {
    const escapedTitle = escapeRegExp(title);
    const pattern = new RegExp(
      String.raw`(?:^|\r?\n)[ \t]*###\s+${escapedTitle}[ \t]*\r?\n([\s\S]*?)(?=\r?\n[ \t]*###\s+|\s*$)`,
      flags
    );

    return removeComments(body.match(pattern)?.[1] ?? "").trim();
  }

  function scalar(title: string): string {
    const value =
      section(title)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? "";

    return value === NO_RESPONSE ? "" : value;
  }

  function required(title: string, message?: RequiredMessage): string {
    const value = scalar(title);

    if (!value) {
      const errorMessage =
        typeof message === "function"
          ? message(title)
          : (message ?? `Missing required field: ${title}`);
      throw new Error(errorMessage);
    }

    return value;
  }

  function lines(title: string): string[] {
    return section(title)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && line !== NO_RESPONSE);
  }

  function checkboxes(title: string): string[] {
    return lines(title)
      .filter((line) => /^-\s*\[[xX]\]\s+/.test(line))
      .map((line) => line.replace(/^-\s*\[[xX]\]\s+/, "").trim())
      .filter(Boolean);
  }

  function checkboxEnabled(title: string, checkedLabel: string): boolean {
    return checkboxes(title).includes(checkedLabel);
  }

  function boolean(title: string): boolean {
    const raw = required(title);
    const value = raw.toLowerCase();

    if (value === "true") return true;
    if (value === "false") return false;

    throw new Error(`Invalid boolean value for ${title}: ${value}`);
  }

  function number(title: string): number {
    const raw = required(title);
    const value = Number(raw);

    if (!Number.isFinite(value)) {
      throw new Error(`Invalid number value for ${title}: ${raw}`);
    }

    return value;
  }

  return {
    section,
    scalar,
    required,
    lines,
    checkboxes,
    checkboxEnabled,
    boolean,
    number,
  };
}
