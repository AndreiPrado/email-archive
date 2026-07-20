import logger from "../utils/logger.js";
import { GraphApiError, isRetryableStatusCode } from "./graph-errors.js";
import { getRetryAfterMs, withRetry } from "./graph-retry.js";
import type {
  BatchRequest,
  BatchResponse,
  BatchResult,
  GraphListResponse,
} from "./graph-types.js";

const BASE_URL = "https://graph.microsoft.com/v1.0";

export class GraphClient {
  constructor(private readonly tokenGetter: () => Promise<string>) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Makes a GET request to the Graph API and returns the parsed response body.
   * All requests include the Prefer: IdType="ImmutableId" header.
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return withRetry(() => {
      const url = this.buildUrl(`${BASE_URL}${path}`, params);
      return this.request<T>(url);
    });
  }

  /**
   * Makes a POST request to the Graph API and returns the parsed response body.
   */
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return withRetry(() =>
      this.request<T>(`${BASE_URL}${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  /**
   * Executes a batch of up to 20 Graph API requests in a single HTTP call.
   * Throws GraphApiError if more than 20 requests are provided.
   * Returns the individual responses from the batch; callers are responsible
   * for inspecting each response's status.
   */
  async batch(requests: BatchRequest[]): Promise<BatchResponse[]> {
    if (requests.length > 20) {
      throw new GraphApiError(
        400,
        "ErrorInvalidRequest",
        `Batch size ${requests.length} exceeds the maximum of 20 requests`,
        false,
      );
    }

    logger.debug({ count: requests.length }, "Executing Graph API batch request");

    const result = await this.post<BatchResult>("/$batch", { requests });
    return result.responses;
  }

  /**
   * Fetches all pages of a paginated Graph API list endpoint, calling onPage
   * once per page with that page's items.
   * Follows @odata.nextLink automatically until no further pages exist.
   */
  async paginate<T>(
    path: string,
    params: Record<string, string>,
    onPage: (items: T[]) => Promise<void>,
  ): Promise<void> {
    let nextLink: string | undefined = this.buildUrl(`${BASE_URL}${path}`, params);
    let page = 0;

    while (nextLink !== undefined) {
      const url: string = nextLink;
      const response: GraphListResponse<T> = await withRetry<GraphListResponse<T>>(() =>
        this.request<GraphListResponse<T>>(url),
      );

      page++;
      logger.debug(
        { page, itemCount: response.value.length, hasNextPage: !!response["@odata.nextLink"] },
        "Graph API page received",
      );

      await onPage(response.value);

      nextLink = response["@odata.nextLink"];
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Core fetch wrapper: adds auth + required headers, parses errors, and
   * throws GraphApiError on non-2xx responses.
   */
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const token = await this.tokenGetter();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: 'IdType="ImmutableId"',
    };

    const response = await fetch(url, { ...init, headers });

    if (response.ok) {
      // Handle 204 No Content (e.g. delete operations that return nothing)
      if (response.status === 204) {
        return undefined as unknown as T;
      }
      return (await response.json()) as T;
    }

    // Parse the Graph API error envelope
    let errorCode = "UnknownError";
    let errorMessage = response.statusText;

    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      errorCode = body?.error?.code ?? errorCode;
      errorMessage = body?.error?.message ?? errorMessage;
    } catch {
      // Ignore JSON parse failures; use defaults set above
    }

    const retryable = isRetryableStatusCode(response.status);
    const err = new GraphApiError(response.status, errorCode, errorMessage, retryable);

    // Attach Retry-After delay so withRetry can honour it
    const retryAfterMs = getRetryAfterMs(response.headers);
    if (retryAfterMs !== null) {
      err.retryAfterMs = retryAfterMs;
    }

    logger.debug(
      {
        statusCode: response.status,
        errorCode,
        errorMessage,
        retryable,
        retryAfterMs,
        url,
      },
      "Graph API error response",
    );

    throw err;
  }

  private buildUrl(base: string, params?: Record<string, string>): string {
    const url = new URL(base);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }
}
