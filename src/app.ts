import type { ArchiveConfig, ArchiveDecision } from "./emails/archive-policy.js";
import type { EmailFetcher } from "./emails/email-fetcher.js";
import type { MoveService, MoveRequest } from "./emails/move-service.js";
import type { FolderService } from "./folders/folder-service.js";
import type { OutlookMessage } from "./graph/graph-types.js";
import type {
  UpsertRecordInput,
  ProcessingStatus,
} from "./persistence/processing-repository.js";
import { getReceivedYear } from "./utils/dates.js";
import logger from "./utils/logger.js";

export type { UpsertRecordInput };

export interface RunOptions extends ArchiveConfig {
  resume: boolean;
  verbose: boolean;
  yes: boolean;
}

export interface RunSummary {
  runId: string;
  totalRead: number;
  totalEligible: number;
  totalMoved: number;
  totalSkipped: number;
  totalFailed: number;
  byDestination: Record<string, number>;
  skippedReasons: Record<string, number>;
  failureReasons: Record<string, number>;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
}

export interface ProcessingRepositoryLike {
  upsert(input: UpsertRecordInput): void;
  findByImmutableId(id: string): { status: string } | null;
  getRunSummary(runId: string): { status: string; count: number }[];
  updateStatus(immutableId: string, status: ProcessingStatus, errorMessage?: string): void;
  markAsMoved(immutableId: string, destinationFolder: string): void;
}

const PROGRESS_INTERVAL = 500;

function buildUpsertInput(
  message: OutlookMessage,
  runId: string,
  decision: ArchiveDecision,
  status: ProcessingStatus,
  overrideReason?: string,
): UpsertRecordInput {
  const receivedYear = getReceivedYear(message.receivedDateTime);
  return {
    runId,
    immutableId: message.id,
    internetMessageId: message.internetMessageId,
    conversationId: message.conversationId,
    subject: message.subject,
    sender: message.from?.emailAddress?.address,
    receivedAt: message.receivedDateTime,
    receivedYear,
    destinationFolder: decision.action === "move" ? decision.destinationFolder : undefined,
    action: decision.action,
    status,
    reason: overrideReason ?? decision.reason,
  };
}

export class App {
  constructor(
    private readonly fetcher: EmailFetcher,
    private readonly folderService: FolderService,
    private readonly policy: (msg: OutlookMessage) => ArchiveDecision,
    private readonly repository: ProcessingRepositoryLike,
    private readonly moveService?: MoveService,
  ) {}

  async run(options: RunOptions): Promise<RunSummary> {
    const runId = new Date().toISOString();
    const startedAt = runId;

    let totalEligible = 0;
    let totalMoved = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    const byDestination: Record<string, number> = {};
    const skippedReasons: Record<string, number> = {};
    const failureReasons: Record<string, number> = {};

    // For non-dry-run: accumulate move requests and folder name mapping
    const pendingMoves: MoveRequest[] = [];
    const folderIdToName = new Map<string, string>();

    // Local counter for progress display (excludes already-moved messages)
    let processedCount = 0;

    logger.info({ runId, dryRun: options.dryRun, options }, "Starting archive run");

    const fetchOptions = {
      year: options.year,
      before: options.before,
      limit: options.limit,
    };

    const { total: totalRead } = await this.fetcher.fetchMessages(
      fetchOptions,
      async (messages) => {
        for (const message of messages) {
          // Resume: skip messages already moved in a previous run
          const existing = this.repository.findByImmutableId(message.id);
          if (existing?.status === "moved") {
            logger.debug({ messageId: message.id }, "Skipping already-moved message");
            continue;
          }

          processedCount++;

          // Evaluate archive policy
          const decision = this.policy(message);

          if (decision.action === "skip") {
            this.repository.upsert(
              buildUpsertInput(message, runId, decision, "skipped"),
            );
            totalSkipped++;
            skippedReasons[decision.reason] = (skippedReasons[decision.reason] ?? 0) + 1;
          } else {
            // action === "move"
            totalEligible++;

            if (options.dryRun) {
              byDestination[decision.destinationFolder] =
                (byDestination[decision.destinationFolder] ?? 0) + 1;
              this.repository.upsert(
                buildUpsertInput(message, runId, decision, "skipped", "dry-run"),
              );
              skippedReasons["Dry run"] = (skippedReasons["Dry run"] ?? 0) + 1;
            } else {
              // Register as pending before move
              this.repository.upsert(
                buildUpsertInput(message, runId, decision, "pending"),
              );
              // Resolve destination folder ID and queue move request
              const folderId = await this.folderService.resolveArchiveFolder(
                decision.destinationFolder,
              );
              folderIdToName.set(folderId, decision.destinationFolder);
              pendingMoves.push({
                messageId: message.id,
                destinationFolderId: folderId,
                runId,
                immutableId: message.id,
              });
            }
          }

          // Progress display every PROGRESS_INTERVAL messages
          if (processedCount % PROGRESS_INTERVAL === 0) {
            console.log(
              `Progresso: ${processedCount} mensagens processadas` +
                ` | elegíveis: ${totalEligible}` +
                ` | ignoradas: ${totalSkipped}`,
            );
          }
        }
      },
    );

    // Process batch moves after fetch completes
    if (!options.dryRun && this.moveService !== undefined && pendingMoves.length > 0) {
      logger.info({ count: pendingMoves.length }, "Starting batch move");
      const results = await this.moveService.moveMessages(pendingMoves);

      for (const result of results) {
        if (result.success) {
          totalMoved++;
          const folderName =
            folderIdToName.get(result.destinationFolderId) ?? result.destinationFolderId;
          byDestination[folderName] = (byDestination[folderName] ?? 0) + 1;
          this.repository.markAsMoved(result.messageId, folderName);
        } else {
          totalFailed++;
          const reason = result.error ?? "Unknown error";
          failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
          this.repository.updateStatus(result.messageId, "failed", result.error);
        }
      }
    }

    const finishedAt = new Date().toISOString();

    logger.info(
      { runId, totalRead, totalEligible, totalMoved, totalSkipped, totalFailed },
      "Archive run complete",
    );

    return {
      runId,
      totalRead,
      totalEligible,
      totalMoved,
      totalSkipped,
      totalFailed,
      byDestination,
      skippedReasons,
      failureReasons,
      dryRun: options.dryRun,
      startedAt,
      finishedAt,
    };
  }
}
