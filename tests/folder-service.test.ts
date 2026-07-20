import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env and logger before importing modules that depend on them
vi.mock("../src/config/env.js", () => ({
  env: {
    ARCHIVE_OLDEST_FOLDER_MAX_YEAR: 2022,
    BATCH_SIZE: 20,
    MAX_CONCURRENCY: 2,
    LOG_LEVEL: "info",
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

import { FolderService } from "../src/folders/folder-service.js";
import type { GraphClient } from "../src/graph/graph-client.js";

describe("FolderService", () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let mockPost: ReturnType<typeof vi.fn>;
  let service: FolderService;

  beforeEach(() => {
    mockGet = vi.fn();
    mockPost = vi.fn();
    service = new FolderService({
      get: mockGet,
      post: mockPost,
      batch: vi.fn(),
      paginate: vi.fn(),
    } as unknown as GraphClient);
  });

  it("1. reutiliza pasta Archive existente", async () => {
    mockGet
      .mockResolvedValueOnce({ value: [{ id: "archive-id", displayName: "Archive" }] })
      .mockResolvedValueOnce({ value: [{ id: "folder-2023-id", displayName: "2023" }] });

    await service.resolveArchiveFolder("2023");

    expect(mockPost).not.toHaveBeenCalledWith("/me/mailFolders", { displayName: "Archive" });
  });

  it("2. cria pasta Archive se não existir", async () => {
    mockGet
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [] });
    mockPost
      .mockResolvedValueOnce({ id: "new-archive-id", displayName: "Archive" })
      .mockResolvedValueOnce({ id: "new-folder-id", displayName: "2023" });

    await service.resolveArchiveFolder("2023");

    expect(mockPost).toHaveBeenCalledWith("/me/mailFolders", { displayName: "Archive" });
  });

  it("3. reutiliza subpasta existente", async () => {
    mockGet
      .mockResolvedValueOnce({ value: [{ id: "archive-id", displayName: "Archive" }] })
      .mockResolvedValueOnce({ value: [{ id: "folder-2023-id", displayName: "2023" }] });

    const result = await service.resolveArchiveFolder("2023");

    expect(result).toBe("folder-2023-id");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("4. cria subpasta se não existir", async () => {
    mockGet
      .mockResolvedValueOnce({ value: [{ id: "archive-id", displayName: "Archive" }] })
      .mockResolvedValueOnce({ value: [] });
    mockPost.mockResolvedValueOnce({ id: "new-folder-id", displayName: "2023" });

    const result = await service.resolveArchiveFolder("2023");

    expect(result).toBe("new-folder-id");
    expect(mockPost).toHaveBeenCalledWith(
      "/me/mailFolders/archive-id/childFolders",
      { displayName: "2023" },
    );
  });

  it("5. cache em memória evita requests repetidos", async () => {
    mockGet
      .mockResolvedValueOnce({ value: [{ id: "archive-id", displayName: "Archive" }] })
      .mockResolvedValueOnce({ value: [{ id: "folder-2023-id", displayName: "2023" }] });

    await service.resolveArchiveFolder("2023");
    await service.resolveArchiveFolder("2023");

    const childFolderCalls = mockGet.mock.calls.filter((call) =>
      (call[0] as string).includes("childFolders"),
    );
    expect(childFolderCalls).toHaveLength(1);
  });

  it("6. não cria pastas duplicadas", async () => {
    mockGet
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [] })
      .mockResolvedValueOnce({ value: [] });
    mockPost
      .mockResolvedValueOnce({ id: "new-archive-id", displayName: "Archive" })
      .mockResolvedValueOnce({ id: "folder-2023-id", displayName: "2023" })
      .mockResolvedValueOnce({ id: "folder-2024-id", displayName: "2024" });

    await service.resolveArchiveFolder("2023");
    await service.resolveArchiveFolder("2024");

    const archivePostCalls = mockPost.mock.calls.filter(
      (call) => call[0] === "/me/mailFolders",
    );
    expect(archivePostCalls).toHaveLength(1);
  });
});
