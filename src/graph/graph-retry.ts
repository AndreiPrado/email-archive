import { env } from "../config/env.js";
import logger from "../utils/logger.js";
import { GraphApiError, isRetryableError } from "./graph-errors.js";

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Reads the Retry-After response header and converts it to milliseconds.
 * The header value is interpreted as seconds (integer or float).
 * Returns null if the header is absent or not a valid number.
 */
export function getRetryAfterMs(headers: Headers): number | null {
  const value = headers.get("Retry-After");
  if (value === null) return null;
  const seconds = parseFloat(value);
  if (isNaN(seconds) || seconds < 0) return null;
  return Math.ceil(seconds * 1000);
}

/**
 * Executes fn, retrying on retryable errors using exponential backoff with jitter.
 *
 * Backoff formula: Math.min(baseDelayMs * 2^attempt, maxDelayMs) + random(0–1000) ms
 *
 * When a GraphApiError carries a retryAfterMs value (from a Retry-After header),
 * that value is used as the delay instead of the backoff formula.
 *
 * Non-retryable errors (e.g. 400, 401, 403, 404) are rethrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts: RetryOptions = {
    maxRetries: options?.maxRetries ?? env.MAX_RETRIES,
    baseDelayMs: options?.baseDelayMs ?? 1000,
    maxDelayMs: options?.maxDelayMs ?? 30000,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt >= opts.maxRetries) {
        break;
      }

      // Determine delay: respect Retry-After when present, otherwise use backoff.
      let delayMs: number;
      if (error instanceof GraphApiError && error.retryAfterMs != null) {
        delayMs = error.retryAfterMs;
      } else {
        const backoff = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt),
          opts.maxDelayMs,
        );
        const jitter = Math.random() * 1000;
        delayMs = backoff + jitter;
      }

      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          delayMs: Math.round(delayMs),
          statusCode: error instanceof GraphApiError ? error.statusCode : undefined,
          errorCode: error instanceof GraphApiError ? error.errorCode : undefined,
        },
        "Graph API request failed, retrying",
      );

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
