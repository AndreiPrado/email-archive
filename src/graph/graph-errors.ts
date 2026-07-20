export class GraphApiError extends Error {
  /**
   * Optional delay in milliseconds to wait before retrying.
   * Populated by GraphClient when the Retry-After response header is present.
   */
  public retryAfterMs?: number;

  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

/**
 * Returns true for status codes that are safe to retry:
 * 429 (Too Many Requests), 500, 502, 503, 504.
 */
export function isRetryableStatusCode(statusCode: number): boolean {
  return [429, 500, 502, 503, 504].includes(statusCode);
}

/**
 * Returns true if the error is a GraphApiError marked as retryable.
 */
export function isRetryableError(error: unknown): boolean {
  return error instanceof GraphApiError && error.retryable;
}
