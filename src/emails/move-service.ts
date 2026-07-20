import { GraphClient } from "../graph/graph-client.js";
import { ProcessingRepository } from "../persistence/processing-repository.js";
import { runWithConcurrency } from "../utils/concurrency.js";
import { env } from "../config/env.js";
import logger from "../utils/logger.js";
import type { BatchRequest } from "../graph/graph-types.js";

export interface MoveRequest {
  messageId: string;
  destinationFolderId: string;
  runId: string;
  immutableId: string;
}

export interface MoveResult {
  messageId: string;
  destinationFolderId: string;
  success: boolean;
  attempts: number;
  error?: string;
  statusCode?: number;
}

export class MoveService {
  constructor(
    private readonly client: GraphClient,
    private readonly repository: ProcessingRepository,
  ) {}

  /**
   * Move a list of messages in batches of up to BATCH_SIZE (default 20)
   * with concurrency limited by MAX_CONCURRENCY.
   */
  async moveMessages(requests: MoveRequest[]): Promise<MoveResult[]> {
    if (requests.length === 0) return [];

    const chunkSize = Math.min(env.BATCH_SIZE, 20);
    const chunks: MoveRequest[][] = [];
    for (let i = 0; i < requests.length; i += chunkSize) {
      chunks.push(requests.slice(i, i + chunkSize));
    }

    const tasks = chunks.map((chunk) => () => this.executeBatch(chunk));
    const results = await runWithConcurrency(tasks, env.MAX_CONCURRENCY);
    return results.flat();
  }

  /**
   * Executes a single batch of up to 20 move requests via the Graph Batch API.
   */
  private async executeBatch(batch: MoveRequest[]): Promise<MoveResult[]> {
    // Mark all messages as "moving" before submitting the batch
    for (const req of batch) {
      this.repository.updateStatus(req.immutableId, "moving");
    }

    const batchRequests: BatchRequest[] = batch.map((req) => ({
      id: req.messageId,
      method: "POST",
      url: `/me/messages/${req.messageId}/move`,
      headers: { "Content-Type": "application/json" },
      body: { destinationId: req.destinationFolderId },
    }));

    // Build a map from messageId → MoveRequest for O(1) lookup
    const requestMap = new Map<string, MoveRequest>(
      batch.map((req) => [req.messageId, req]),
    );

    const results: MoveResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      const responses = await this.client.batch(batchRequests);

      for (const response of responses) {
        const req = requestMap.get(response.id);
        if (req === undefined) {
          logger.warn({ responseId: response.id }, "Batch response ID does not match any request");
          continue;
        }

        const isSuccess = response.status >= 200 && response.status < 300;

        if (isSuccess) {
          this.repository.markAsMoved(req.immutableId, req.destinationFolderId);
          results.push({
            messageId: req.messageId,
            destinationFolderId: req.destinationFolderId,
            success: true,
            attempts: 1,
            statusCode: response.status,
          });
          successCount++;
        } else {
          const errorMessage = extractErrorMessage(response.body, response.status);

          if (response.status === 429) {
            this.repository.updateStatus(req.immutableId, "failed", "429 Too Many Requests");
          } else {
            this.repository.updateStatus(req.immutableId, "failed", errorMessage);
          }

          results.push({
            messageId: req.messageId,
            destinationFolderId: req.destinationFolderId,
            success: false,
            attempts: 1,
            error: errorMessage,
            statusCode: response.status,
          });
          failureCount++;
        }
      }
    } catch (error) {
      // The HTTP batch request itself failed (after all retries in GraphClient)
      const errorMessage =
        error instanceof Error ? error.message : "Unexpected batch error";

      logger.error({ error, batchSize: batch.length }, "Graph batch request failed");

      for (const req of batch) {
        if (!results.some((r) => r.messageId === req.messageId)) {
          this.repository.updateStatus(req.immutableId, "failed", errorMessage);
          results.push({
            messageId: req.messageId,
            destinationFolderId: req.destinationFolderId,
            success: false,
            attempts: 1,
            error: errorMessage,
          });
          failureCount++;
        }
      }
    }

    logger.info(
      { batchSize: batch.length, successCount, failureCount },
      "Batch move completed",
    );

    return results;
  }
}

function extractErrorMessage(body: unknown, statusCode: number): string {
  if (body !== null && typeof body === "object") {
    const b = body as { error?: { message?: string; code?: string } };
    if (b.error?.message) {
      return `${statusCode} - ${b.error.message}`;
    }
  }
  return String(statusCode);
}
