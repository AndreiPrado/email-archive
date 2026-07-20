import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env and logger before importing modules that depend on them
vi.mock("../src/config/env.js", () => ({
  env: {
    BATCH_SIZE: 20,
    MAX_CONCURRENCY: 2,
    MAX_RETRIES: 5,
    LOG_LEVEL: "info",
    ARCHIVE_OLDEST_FOLDER_MAX_YEAR: 2022,
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

import { MoveService, type MoveRequest } from "../src/emails/move-service.js";
import type { GraphClient } from "../src/graph/graph-client.js";
import type { ProcessingRepository } from "../src/persistence/processing-repository.js";
import { GraphApiError } from "../src/graph/graph-errors.js";

describe("MoveService", () => {
  let mockBatch: ReturnType<typeof vi.fn>;
  let mockUpdateStatus: ReturnType<typeof vi.fn>;
  let mockMarkAsMoved: ReturnType<typeof vi.fn>;
  let service: MoveService;

  beforeEach(() => {
    mockBatch = vi.fn();
    mockUpdateStatus = vi.fn();
    mockMarkAsMoved = vi.fn();

    const mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      batch: mockBatch,
      paginate: vi.fn(),
    } as unknown as GraphClient;

    const mockRepository = {
      updateStatus: mockUpdateStatus,
      markAsMoved: mockMarkAsMoved,
      upsert: vi.fn(),
      findByImmutableId: vi.fn(),
      incrementAttempts: vi.fn(),
      getRunSummary: vi.fn(),
      getFailedRecords: vi.fn(),
    } as unknown as ProcessingRepository;

    service = new MoveService(mockClient, mockRepository);
  });

  it("1. move com sucesso", async () => {
    const request: MoveRequest = {
      messageId: "msg-1",
      destinationFolderId: "dest-folder-id",
      runId: "run-1",
      immutableId: "imm-1",
    };
    mockBatch.mockResolvedValueOnce([{ id: "msg-1", status: 200, body: {} }]);

    const results = await service.moveMessages([request]);

    expect(mockUpdateStatus).toHaveBeenCalledWith("imm-1", "moving");
    expect(mockMarkAsMoved).toHaveBeenCalledWith("imm-1", "dest-folder-id");
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it("2. falha com 429 marca como failed", async () => {
    const request: MoveRequest = {
      messageId: "msg-1",
      destinationFolderId: "dest-folder-id",
      runId: "run-1",
      immutableId: "imm-1",
    };
    mockBatch.mockResolvedValueOnce([{ id: "msg-1", status: 429, body: {} }]);

    const results = await service.moveMessages([request]);

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      "imm-1",
      "failed",
      expect.stringContaining("429"),
    );
    expect(results[0].success).toBe(false);
  });

  it("3. falha com 404 marca como failed", async () => {
    const request: MoveRequest = {
      messageId: "msg-1",
      destinationFolderId: "dest-folder-id",
      runId: "run-1",
      immutableId: "imm-1",
    };
    mockBatch.mockResolvedValueOnce([{ id: "msg-1", status: 404, body: {} }]);

    const results = await service.moveMessages([request]);

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      "imm-1",
      "failed",
      expect.any(String),
    );
    expect(results[0].success).toBe(false);
  });

  it("4. falha geral do batch (exception) marca todas como failed", async () => {
    const requests: MoveRequest[] = [
      { messageId: "msg-1", destinationFolderId: "dest-id", runId: "run-1", immutableId: "imm-1" },
      { messageId: "msg-2", destinationFolderId: "dest-id", runId: "run-1", immutableId: "imm-2" },
    ];
    const batchError = new GraphApiError(500, "ServiceUnavailable", "Batch failed", true);
    mockBatch.mockRejectedValueOnce(batchError);

    const results = await service.moveMessages(requests);

    expect(mockMarkAsMoved).not.toHaveBeenCalled();
    expect(mockUpdateStatus).toHaveBeenCalledWith("imm-1", "failed", "Batch failed");
    expect(mockUpdateStatus).toHaveBeenCalledWith("imm-2", "failed", "Batch failed");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success === false)).toBe(true);
  });

  it("5. múltiplas mensagens no batch — sucessos e falhas misturados", async () => {
    const requests: MoveRequest[] = [
      { messageId: "msg-1", destinationFolderId: "dest-id", runId: "run-1", immutableId: "imm-1" },
      { messageId: "msg-2", destinationFolderId: "dest-id", runId: "run-1", immutableId: "imm-2" },
    ];
    mockBatch.mockResolvedValueOnce([
      { id: "msg-1", status: 200, body: {} },
      { id: "msg-2", status: 429, body: {} },
    ]);

    const results = await service.moveMessages(requests);

    expect(mockMarkAsMoved).toHaveBeenCalledWith("imm-1", "dest-id");
    expect(mockMarkAsMoved).not.toHaveBeenCalledWith("imm-2", expect.anything());
    expect(mockUpdateStatus).toHaveBeenCalledWith("imm-2", "failed", "429 Too Many Requests");

    const successResult = results.find((r) => r.messageId === "msg-1");
    const failureResult = results.find((r) => r.messageId === "msg-2");
    expect(successResult?.success).toBe(true);
    expect(failureResult?.success).toBe(false);
  });

  it("6. divide em múltiplos batches quando excede BATCH_SIZE", async () => {
    const requests: MoveRequest[] = Array.from({ length: 25 }, (_, i) => ({
      messageId: `msg-${i + 1}`,
      destinationFolderId: "dest-id",
      runId: "run-1",
      immutableId: `imm-${i + 1}`,
    }));

    // Return success responses matching each request's id, regardless of order
    mockBatch.mockImplementation((batchRequests: Array<{ id: string }>) =>
      Promise.resolve(batchRequests.map((req) => ({ id: req.id, status: 200, body: {} }))),
    );

    const results = await service.moveMessages(requests);

    expect(mockBatch).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(25);
    expect(results.every((r) => r.success === true)).toBe(true);
  });
});
