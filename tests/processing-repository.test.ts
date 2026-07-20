import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/persistence/migrations.js";
import {
  ProcessingRepository,
  type UpsertRecordInput,
} from "../src/persistence/processing-repository.js";

function makeRecord(overrides: Partial<UpsertRecordInput> = {}): UpsertRecordInput {
  return {
    runId: "run-1",
    immutableId: "imm-1",
    receivedAt: "2023-06-15T10:00:00Z",
    receivedYear: 2023,
    action: "move",
    status: "pending",
    ...overrides,
  };
}

describe("ProcessingRepository", () => {
  let db: Database.Database;
  let repo: ProcessingRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new ProcessingRepository(db);
  });

  it("1. upsert insere novo registro", () => {
    repo.upsert(makeRecord({ immutableId: "imm-1", status: "pending" }));

    const record = repo.findByImmutableId("imm-1");

    expect(record).not.toBeNull();
    expect(record?.immutableId).toBe("imm-1");
    expect(record?.status).toBe("pending");
    expect(record?.runId).toBe("run-1");
  });

  it("2. upsert não sobrescreve registro com status 'moved'", () => {
    repo.upsert(makeRecord({ immutableId: "imm-1", status: "moved" }));
    repo.upsert(makeRecord({ immutableId: "imm-1", status: "failed" }));

    const record = repo.findByImmutableId("imm-1");

    expect(record?.status).toBe("moved");
  });

  it("3. upsert atualiza registro com status diferente de 'moved'", () => {
    repo.upsert(makeRecord({ immutableId: "imm-1", status: "pending" }));
    repo.upsert(makeRecord({ immutableId: "imm-1", status: "failed", errorMessage: "erro" }));

    const record = repo.findByImmutableId("imm-1");

    expect(record?.status).toBe("failed");
    expect(record?.errorMessage).toBe("erro");
  });

  it("4. updateStatus atualiza apenas o status", () => {
    repo.upsert(makeRecord({ immutableId: "imm-1", status: "pending" }));
    repo.updateStatus("imm-1", "moving");

    const record = repo.findByImmutableId("imm-1");

    expect(record?.status).toBe("moving");
  });

  it("5. markAsMoved atualiza status e destinationFolder", () => {
    repo.upsert(makeRecord({ immutableId: "imm-1", status: "moving" }));
    repo.markAsMoved("imm-1", "Archive/2023");

    const record = repo.findByImmutableId("imm-1");

    expect(record?.status).toBe("moved");
    expect(record?.destinationFolder).toBe("Archive/2023");
  });

  it("6. findByImmutableId retorna null para ID inexistente", () => {
    const record = repo.findByImmutableId("non-existent-id");

    expect(record).toBeNull();
  });

  it("7. getRunSummary retorna contagens corretas", () => {
    for (let i = 0; i < 3; i++) {
      repo.upsert(makeRecord({ immutableId: `moved-${i}`, status: "moved" }));
    }
    for (let i = 0; i < 2; i++) {
      repo.upsert(makeRecord({ immutableId: `failed-${i}`, status: "failed" }));
    }

    const summary = repo.getRunSummary("run-1");

    const movedEntry = summary.find((s) => s.status === "moved");
    const failedEntry = summary.find((s) => s.status === "failed");
    expect(movedEntry?.count).toBe(3);
    expect(failedEntry?.count).toBe(2);
  });

  it("8. getFailedRecords retorna apenas falhas", () => {
    repo.upsert(makeRecord({ immutableId: "moved-1", status: "moved" }));
    repo.upsert(makeRecord({ immutableId: "failed-1", status: "failed" }));
    repo.upsert(makeRecord({ immutableId: "failed-2", status: "failed" }));

    const failed = repo.getFailedRecords("run-1");

    expect(failed).toHaveLength(2);
    expect(failed.every((r) => r.status === "failed")).toBe(true);
  });
});
