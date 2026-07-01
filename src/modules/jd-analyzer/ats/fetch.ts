import { RED_CROSS } from "@/constants/log";

import { logger } from "@/utils/logger";

export class HttpStatusCode {
  static readonly OK = 200;

  static readonly BAD_REQUEST = 400;
  static readonly UNAUTHORIZED = 401;
  static readonly FORBIDDEN = 403;
  static readonly NOT_FOUND = 404;
  static readonly METHOD_NOT_ALLOWED = 405;
  static readonly NOT_ACCEPTABLE = 406;
  static readonly PROXY_AUTHENTICATION_REQUIRED = 407;
  static readonly REQUEST_TIMEOUT = 408;
  static readonly CONFLICT = 409;
  static readonly GONE = 410;
  static readonly LENGTH_REQUIRED = 411;
  static readonly PRECONDITION_FAILED = 412;
  static readonly PAYLOAD_TOO_LARGE = 413;
  static readonly URI_TOO_LONG = 414;
  static readonly UNSUPPORTED_MEDIA_TYPE = 415;
  static readonly RANGE_NOT_SATISFIABLE = 416;
  static readonly EXPECTATION_FAILED = 417;
  static readonly I_AM_A_TEAPOT = 418;
  static readonly UNPROCESSABLE_ENTITY = 422;
  static readonly LOCKED = 423;
  static readonly FAILED_DEPENDENCY = 424;
  static readonly UPGRADE_REQUIRED = 426;
  static readonly PRECONDITION_REQUIRED = 428;
  static readonly TOO_MANY_REQUESTS = 429;

  static readonly INTERNAL_SERVER_ERROR = 500;
  static readonly BAD_GATEWAY = 502;
  static readonly SERVICE_UNAVAILABLE = 503;

  static is2xx(code: number): boolean {
    return code >= 200 && code < 300;
  }

  static is3xx(code: number): boolean {
    return code >= 300 && code < 400;
  }

  static is4xx(code: number): boolean {
    return code >= 400 && code < 500;
  }

  static is5xx(code: number): boolean {
    return code >= 500 && code < 600;
  }

  static isOk(code: number): boolean {
    return code === HttpStatusCode.OK;
  }

  static isError(code: number): boolean {
    return code >= 400;
  }
}

export const NETWORK_ERROR_CODE = 0;

export type HttpStatus = number;

export interface JDFetchStatus {
  code: HttpStatus | typeof NETWORK_ERROR_CODE;
  desc: string;
}

export interface JDFetchResult {
  jd: string | null;
  error: JDFetchStatus;
}

export const JD_FETCH_OK: JDFetchStatus = {
  code: HttpStatusCode.OK,
  desc: "",
};

export const JD_FETCH_ERROR = {
  invalidUrl: (desc = "Invalid URL"): JDFetchStatus => ({
    code: HttpStatusCode.BAD_REQUEST,
    desc,
  }),

  http: (status: HttpStatus, statusText: string): JDFetchStatus => ({
    code: status,
    desc: statusText,
  }),

  internal: (desc = "Internal server error"): JDFetchStatus => ({
    code: HttpStatusCode.INTERNAL_SERVER_ERROR,
    desc,
  }),

  noData: (desc = "No data in response"): JDFetchStatus => ({
    code: HttpStatusCode.NOT_FOUND,
    desc,
  }),

  fetch: (desc: string): JDFetchStatus => ({
    code: NETWORK_ERROR_CODE,
    desc,
  }),
} as const;

type FetchATSJDOptions = {
  transform?: (data: unknown) => string | null;
  logContext?: Record<string, unknown>;
  logLabel?: string;
};

export async function fetchJD(
  apiUrl: string,
  signal: AbortSignal,
  options: FetchATSJDOptions = {}
): Promise<JDFetchResult> {
  const { transform, logContext = {}, logLabel = "ATS JD" } = options;

  try {
    const res = await fetch(apiUrl, { signal });

    if (!res.ok) {
      const error = JD_FETCH_ERROR.http(res.status, res.statusText);

      logger.error(
        {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          ...logContext,
        },
        `${RED_CROSS} Failed to fetch ${logLabel}`
      );

      return {
        jd: null,
        error,
      };
    }

    const data = await res.json();

    const jd = transform ? transform(data) : data ? JSON.stringify(data) : null;

    if (!jd) {
      return {
        jd: null,
        error: JD_FETCH_ERROR.noData(),
      };
    }

    return {
      jd,
      error: JD_FETCH_OK,
    };
  } catch (err) {
    const desc = err instanceof Error ? err.message : "Unknown fetch error";

    logger.error(
      {
        err,
        apiUrl,
        ...logContext,
      },
      `${RED_CROSS} Error fetching ${logLabel}`
    );

    return {
      jd: null,
      error: JD_FETCH_ERROR.fetch(desc),
    };
  }
}
