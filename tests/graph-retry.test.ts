import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock env and logger before importing modules that depend on them
vi.mock("../src/config/env.js", () => ({
  env: {
    MAX_RETRIES: 5,
    BATCH_SIZE: 20,
    MAX_CONCURRENCY: 2,
    LOG_LEVEL: "info",
  },
}));

vi.mock("../src/utils/logger.js", () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { withRetry } from "../src/graph/graph-retry.js";
import { GraphApiError } from "../src/graph/graph-errors.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. retries on recoverable error (429) and returns the successful value", async () => {
    const error = new GraphApiError(429, "TooManyRequests", "Rate limited", true);
    error.retryAfterMs = 0;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("success");

    const promise = withRetry(fn, { maxRetries: 1 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe("success");
  });

  it("2. respects retryAfterMs delay before retrying", async () => {
    const error = new GraphApiError(429, "TooManyRequests", "Rate limited", true);
    error.retryAfterMs = 100;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("success");

    const promise = withRetry(fn, { maxRetries: 1 });

    // Advance 50ms — not enough to trigger the retry
    await vi.advanceTimersByTimeAsync(50);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance another 100ms — past the 100ms retryAfterMs delay
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toBe("success");
  });

  it("3. retries on error 500 (ServiceUnavailable)", async () => {
    const error = new GraphApiError(500, "ServiceUnavailable", "Internal Server Error", true);
    error.retryAfterMs = 0;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { maxRetries: 1 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe("ok");
  });

  it("4. does not retry on non-retryable error (400) and propagates the error", async () => {
    const error = new GraphApiError(400, "ErrorInvalidRequest", "Bad request", false);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("5. stops after maxRetries and throws — called 3 times total (1 original + 2 retries)", async () => {
    const error = new GraphApiError(429, "TooManyRequests", "Rate limited", true);
    error.retryAfterMs = 0;

    const fn = vi.fn().mockRejectedValue(error);

    const retryPromise = withRetry(fn, { maxRetries: 2 });
    // Attach the rejection handler BEFORE advancing timers so the eventual
    // rejection is never considered "unhandled" by Node.js.
    const assertion = expect(retryPromise).rejects.toThrow(error);

    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3); // 1 original + 2 retries
  });

  it("6. succeeds on first attempt without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("first-try");

    const result = await withRetry(fn, { maxRetries: 3 });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe("first-try");
  });
});
