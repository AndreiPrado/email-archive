import type { OutlookMessage } from "../graph/graph-types.js";
import { getReceivedYear } from "../utils/dates.js";

export type ArchiveDecision =
  | {
      action: "move";
      destinationFolder: string;
      reason: string;
    }
  | {
      action: "skip";
      reason: string;
    };

export interface ArchiveConfig {
  currentYear: number;
  includeFlagged: boolean;
  includeHighImportance: boolean;
  dryRun: boolean;
  limit?: number;
  year?: number;
  before?: Date;
  oldestFolderMaxYear: number;
}

export function evaluateArchivePolicy(
  message: OutlookMessage,
  config: ArchiveConfig,
): ArchiveDecision {
  const receivedYear = getReceivedYear(message.receivedDateTime);

  if (receivedYear >= config.currentYear) {
    return { action: "skip", reason: "Mensagem do ano corrente" };
  }

  if (!config.includeFlagged && message.flag?.flagStatus === "flagged") {
    return { action: "skip", reason: "Mensagem sinalizada" };
  }

  if (!config.includeHighImportance && message.importance === "high") {
    return { action: "skip", reason: "Importância alta" };
  }

  const destinationFolder =
    receivedYear <= config.oldestFolderMaxYear
      ? `${config.oldestFolderMaxYear} e anteriores`
      : String(receivedYear);

  return {
    action: "move",
    destinationFolder,
    reason: `Arquivamento por ano: ${receivedYear}`,
  };
}
