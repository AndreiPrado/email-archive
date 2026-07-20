import minimist from "minimist";
import readline from "readline";
import { GraphClient } from "../graph/graph-client.js";
import { EmailFetcher } from "../emails/email-fetcher.js";
import { FolderService } from "../folders/folder-service.js";
import { evaluateArchivePolicy } from "../emails/archive-policy.js";
import { getValidAccessToken } from "../auth/auth-service.js";
import { getCurrentYear } from "../utils/dates.js";
import { env } from "../config/env.js";
import { App } from "../app.js";
import type { RunOptions } from "../app.js";
import { openDatabase } from "../persistence/database.js";
import { runMigrations } from "../persistence/migrations.js";
import { ProcessingRepository } from "../persistence/processing-repository.js";
import { MoveService } from "../emails/move-service.js";
import { formatTextReport, saveReport } from "../reports/run-report.js";
import logger from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

async function promptConfirmation(limit?: number): Promise<boolean> {
  const limitText =
    limit !== undefined ? `até ${limit}` : "todas as elegíveis";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `\nEsta operação moverá ${limitText} mensagens.\nDigite MOVE para continuar (ou Ctrl+C para cancelar): `,
      (answer) => {
        rl.close();
        resolve(answer.trim() === "MOVE");
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = minimist(process.argv.slice(2), {
    boolean: [
      "dry-run",
      "include-flagged",
      "include-high-importance",
      "resume",
      "verbose",
      "yes",
    ],
    string: ["year", "limit", "before"],
  });

  const dryRun: boolean = args["dry-run"] === true;
  const includeFlagged: boolean = args["include-flagged"] === true;
  const includeHighImportance: boolean = args["include-high-importance"] === true;
  const resume: boolean = args["resume"] === true;
  const verbose: boolean = args["verbose"] === true;
  const yes: boolean = args["yes"] === true;

  const year: number | undefined =
    args["year"] !== undefined && args["year"] !== ""
      ? parseInt(args["year"] as string, 10)
      : undefined;

  const limit: number | undefined =
    args["limit"] !== undefined && args["limit"] !== ""
      ? parseInt(args["limit"] as string, 10)
      : undefined;

  const before: Date | undefined =
    args["before"] !== undefined && args["before"] !== ""
      ? new Date(args["before"] as string)
      : undefined;

  const options: RunOptions = {
    dryRun,
    includeFlagged,
    includeHighImportance,
    resume,
    verbose,
    yes,
    year,
    limit,
    before,
    currentYear: getCurrentYear(),
    oldestFolderMaxYear: env.ARCHIVE_OLDEST_FOLDER_MAX_YEAR,
  };

  // ------------------------------------------------------------------
  // Open database and run migrations (always, for both modes)
  // ------------------------------------------------------------------
  const db = openDatabase();
  runMigrations(db);
  const repository = new ProcessingRepository(db);

  // ------------------------------------------------------------------
  // Non-dry-run: confirmation prompt
  // ------------------------------------------------------------------
  if (!dryRun && !yes) {
    const confirmed = await promptConfirmation(limit);
    if (!confirmed) {
      console.log("Operação cancelada.");
      process.exit(0);
    }
  }

  // ------------------------------------------------------------------
  // Build graph client, fetcher, folder service and app
  // ------------------------------------------------------------------
  const graphClient = new GraphClient(getValidAccessToken);
  const fetcher = new EmailFetcher(graphClient);
  const folderService = new FolderService(graphClient);

  const policy = (msg: Parameters<typeof evaluateArchivePolicy>[0]) =>
    evaluateArchivePolicy(msg, options);

  const moveService = dryRun ? undefined : new MoveService(graphClient, repository);
  const app = new App(fetcher, folderService, policy, repository, moveService);

  try {
    const modeLabel = dryRun ? "Dry Run" : "movimentação real";
    console.log(`\nIniciando execução em modo ${modeLabel}...`);

    const summary = await app.run(options);

    const report = formatTextReport(summary);
    console.log("\n" + report);

    const { jsonPath, txtPath } = await saveReport(summary);
    console.log(`Relatório salvo em:\n  ${jsonPath}\n  ${txtPath}`);
  } catch (err) {
    logger.error({ err }, "Archive run failed");
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
