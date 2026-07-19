export interface HtmlResponse {
  response: Response;
  html: string;
}

export async function fetchHtmlResponse(
  input: string | URL,
  init?: RequestInit
): Promise<HtmlResponse> {
  const response = await fetch(input, init);

  return {
    response,
    html: await response.text(),
  };
}

export function isHtmlResponse(raw: string): boolean {
  const trimmed = raw.trimStart().toLowerCase();

  return (
    trimmed.startsWith("<!doctype") || trimmed.startsWith("<?xml") || trimmed.startsWith("<html")
  );
}

export function getSetCookieHeader(response: Response): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  const setCookies = headers.getSetCookie?.();
  const values = (setCookies?.length ? setCookies : [response.headers.get("set-cookie") ?? ""])
    .flatMap((header) => header.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/))
    .filter(Boolean);

  return values
    .map((cookie) => cookie.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
}

export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
