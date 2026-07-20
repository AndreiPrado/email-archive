import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_processing_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      immutable_id TEXT NOT NULL,
      internet_message_id TEXT,
      conversation_id TEXT,
      subject TEXT,
      sender TEXT,
      received_at TEXT NOT NULL,
      received_year INTEGER NOT NULL,
      destination_folder TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_processing_immutable_id
      ON email_processing_state(immutable_id);

    CREATE INDEX IF NOT EXISTS idx_email_processing_run_id
      ON email_processing_state(run_id);

    CREATE INDEX IF NOT EXISTS idx_email_processing_status
      ON email_processing_state(status);
  `);
}
