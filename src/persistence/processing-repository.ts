import type Database from "better-sqlite3";

export type ProcessingStatus =
  | "pending"
  | "skipped"
  | "moving"
  | "moved"
  | "failed";

export interface ProcessingRecord {
  id: number;
  runId: string;
  immutableId: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  sender?: string;
  receivedAt: string;
  receivedYear: number;
  destinationFolder?: string;
  action: "move" | "skip";
  status: ProcessingStatus;
  reason?: string;
  attempts: number;
  errorMessage?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRecordInput {
  runId: string;
  immutableId: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  sender?: string;
  receivedAt: string;
  receivedYear: number;
  destinationFolder?: string;
  action: "move" | "skip";
  status: ProcessingStatus;
  reason?: string;
  attempts?: number;
  errorMessage?: string;
  processedAt?: string;
}

interface RawRow {
  id: number;
  run_id: string;
  immutable_id: string;
  internet_message_id: string | null;
  conversation_id: string | null;
  subject: string | null;
  sender: string | null;
  received_at: string;
  received_year: number;
  destination_folder: string | null;
  action: string;
  status: string;
  reason: string | null;
  attempts: number;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SummaryRow {
  status: string;
  count: number;
}

function mapRow(row: RawRow): ProcessingRecord {
  return {
    id: row.id,
    runId: row.run_id,
    immutableId: row.immutable_id,
    internetMessageId: row.internet_message_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    subject: row.subject ?? undefined,
    sender: row.sender ?? undefined,
    receivedAt: row.received_at,
    receivedYear: row.received_year,
    destinationFolder: row.destination_folder ?? undefined,
    action: row.action as "move" | "skip",
    status: row.status as ProcessingStatus,
    reason: row.reason ?? undefined,
    attempts: row.attempts,
    errorMessage: row.error_message ?? undefined,
    processedAt: row.processed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProcessingRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: UpsertRecordInput): void {
    this.db
      .prepare(
        `
        INSERT INTO email_processing_state (
          run_id, immutable_id, internet_message_id, conversation_id,
          subject, sender, received_at, received_year, destination_folder,
          action, status, reason, attempts, error_message, processed_at,
          updated_at
        ) VALUES (
          @runId, @immutableId, @internetMessageId, @conversationId,
          @subject, @sender, @receivedAt, @receivedYear, @destinationFolder,
          @action, @status, @reason, @attempts, @errorMessage, @processedAt,
          datetime('now')
        )
        ON CONFLICT(immutable_id) DO UPDATE SET
          run_id             = excluded.run_id,
          internet_message_id = excluded.internet_message_id,
          conversation_id    = excluded.conversation_id,
          subject            = excluded.subject,
          sender             = excluded.sender,
          received_at        = excluded.received_at,
          received_year      = excluded.received_year,
          destination_folder = excluded.destination_folder,
          action             = excluded.action,
          status             = excluded.status,
          reason             = excluded.reason,
          attempts           = excluded.attempts,
          error_message      = excluded.error_message,
          processed_at       = excluded.processed_at,
          updated_at         = datetime('now')
        WHERE email_processing_state.status != 'moved'
      `,
      )
      .run({
        runId: input.runId,
        immutableId: input.immutableId,
        internetMessageId: input.internetMessageId ?? null,
        conversationId: input.conversationId ?? null,
        subject: input.subject ?? null,
        sender: input.sender ?? null,
        receivedAt: input.receivedAt,
        receivedYear: input.receivedYear,
        destinationFolder: input.destinationFolder ?? null,
        action: input.action,
        status: input.status,
        reason: input.reason ?? null,
        attempts: input.attempts ?? 0,
        errorMessage: input.errorMessage ?? null,
        processedAt: input.processedAt ?? null,
      });
  }

  findByImmutableId(immutableId: string): ProcessingRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM email_processing_state WHERE immutable_id = ?`,
      )
      .get(immutableId) as RawRow | undefined;

    return row ? mapRow(row) : null;
  }

  updateStatus(
    immutableId: string,
    status: ProcessingStatus,
    errorMessage?: string,
  ): void {
    this.db
      .prepare(
        `
        UPDATE email_processing_state
        SET status = ?, error_message = ?, updated_at = datetime('now')
        WHERE immutable_id = ?
      `,
      )
      .run(status, errorMessage ?? null, immutableId);
  }

  incrementAttempts(immutableId: string): void {
    this.db
      .prepare(
        `
        UPDATE email_processing_state
        SET attempts = attempts + 1, updated_at = datetime('now')
        WHERE immutable_id = ?
      `,
      )
      .run(immutableId);
  }

  markAsMoved(immutableId: string, destinationFolder: string): void {
    this.db
      .prepare(
        `
        UPDATE email_processing_state
        SET
          status             = 'moved',
          destination_folder = ?,
          processed_at       = datetime('now'),
          updated_at         = datetime('now')
        WHERE immutable_id = ?
      `,
      )
      .run(destinationFolder, immutableId);
  }

  getRunSummary(runId: string): { status: ProcessingStatus; count: number }[] {
    const rows = this.db
      .prepare(
        `
        SELECT status, COUNT(*) AS count
        FROM email_processing_state
        WHERE run_id = ?
        GROUP BY status
      `,
      )
      .all(runId) as SummaryRow[];

    return rows.map((row) => ({
      status: row.status as ProcessingStatus,
      count: Number(row.count),
    }));
  }

  getFailedRecords(runId?: string): ProcessingRecord[] {
    if (runId !== undefined) {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM email_processing_state
          WHERE status = 'failed' AND run_id = ?
        `,
        )
        .all(runId) as RawRow[];

      return rows.map(mapRow);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM email_processing_state WHERE status = 'failed'`,
      )
      .all() as RawRow[];

    return rows.map(mapRow);
  }
}
