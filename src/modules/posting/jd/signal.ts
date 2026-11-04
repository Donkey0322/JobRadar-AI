export const DEFAULT_JD_FETCH_TIMEOUT_MS = 5 * 60 * 1000;

export function createJDFetchSignal(): AbortSignal {
  return AbortSignal.timeout(DEFAULT_JD_FETCH_TIMEOUT_MS);
}
