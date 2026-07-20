import { describe, it, expect } from "vitest";
import {
  evaluateArchivePolicy,
  type ArchiveConfig,
} from "../src/emails/archive-policy.js";
import type { OutlookMessage } from "../src/graph/graph-types.js";

const baseMessage: OutlookMessage = {
  id: "msg-1",
  receivedDateTime: "2024-06-15T10:00:00Z",
  importance: "normal",
  isRead: false,
  flag: { flagStatus: "notFlagged" },
  categories: [],
};

const baseConfig: ArchiveConfig = {
  currentYear: 2026,
  includeFlagged: false,
  includeHighImportance: false,
  dryRun: false,
  oldestFolderMaxYear: 2022,
};

describe("evaluateArchivePolicy", () => {
  it("1. ano corrente → skip", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      receivedDateTime: "2026-03-10T08:00:00Z",
    };
    const result = evaluateArchivePolicy(message, baseConfig);
    expect(result.action).toBe("skip");
    expect(result.reason).toBe("Mensagem do ano corrente");
  });

  it("2. ano anterior → move com destinationFolder correto", () => {
    const result = evaluateArchivePolicy(baseMessage, baseConfig);
    expect(result.action).toBe("move");
    if (result.action === "move") {
      expect(result.destinationFolder).toBe("2024");
      expect(result.reason).toBe("Arquivamento por ano: 2024");
    }
  });

  it("3. sinalizada → skip por padrão", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      flag: { flagStatus: "flagged" },
    };
    const result = evaluateArchivePolicy(message, baseConfig);
    expect(result.action).toBe("skip");
    expect(result.reason).toBe("Mensagem sinalizada");
  });

  it("4. sinalizada com includeFlagged: true → move", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      flag: { flagStatus: "flagged" },
    };
    const config: ArchiveConfig = { ...baseConfig, includeFlagged: true };
    const result = evaluateArchivePolicy(message, config);
    expect(result.action).toBe("move");
  });

  it("5. importância alta → skip por padrão", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      importance: "high",
    };
    const result = evaluateArchivePolicy(message, baseConfig);
    expect(result.action).toBe("skip");
    expect(result.reason).toBe("Importância alta");
  });

  it("6. importância alta com includeHighImportance: true → move", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      importance: "high",
    };
    const config: ArchiveConfig = {
      ...baseConfig,
      includeHighImportance: true,
    };
    const result = evaluateArchivePolicy(message, config);
    expect(result.action).toBe("move");
  });

  it("7. ano no limite do oldest folder → pasta 'YYYY e anteriores'", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      receivedDateTime: "2022-11-20T12:00:00Z",
    };
    const result = evaluateArchivePolicy(message, baseConfig);
    expect(result.action).toBe("move");
    if (result.action === "move") {
      expect(result.destinationFolder).toBe("2022 e anteriores");
    }
  });

  it("8. ano abaixo do limite → pasta 'YYYY e anteriores'", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      receivedDateTime: "2019-05-01T00:00:00Z",
    };
    const result = evaluateArchivePolicy(message, baseConfig);
    expect(result.action).toBe("move");
    if (result.action === "move") {
      expect(result.destinationFolder).toBe("2022 e anteriores");
    }
  });

  it("9. ano acima do limite → pasta individual", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      receivedDateTime: "2023-08-30T09:00:00Z",
    };
    const result = evaluateArchivePolicy(message, baseConfig);
    expect(result.action).toBe("move");
    if (result.action === "move") {
      expect(result.destinationFolder).toBe("2023");
    }
  });

  it("10. sinalizada tem prioridade sobre importância alta", () => {
    const message: OutlookMessage = {
      ...baseMessage,
      flag: { flagStatus: "flagged" },
      importance: "high",
    };
    const config: ArchiveConfig = {
      ...baseConfig,
      includeFlagged: false,
      includeHighImportance: false,
    };
    const result = evaluateArchivePolicy(message, config);
    expect(result.action).toBe("skip");
    expect(result.reason).toBe("Mensagem sinalizada");
  });
});
