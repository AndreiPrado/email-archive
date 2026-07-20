import { env } from "../config/env.js";
import { GraphClient } from "../graph/graph-client.js";
import type { GraphListResponse, MailFolder } from "../graph/graph-types.js";
import logger from "../utils/logger.js";

export class FolderService {
  private archiveFolderId: string | null = null;
  private readonly subFolderCache = new Map<string, string>();

  constructor(private readonly client: GraphClient) {}

  /**
   * Retorna o ID da subpasta de destino dentro de Archive (ex: "2024", "2022 e anteriores").
   * Cria a subpasta se não existir. Usa cache em memória para evitar requests repetidos.
   */
  async resolveArchiveFolder(folderName: string): Promise<string> {
    const archiveId = await this.ensureArchiveFolder();

    // 1. Verificar cache em memória
    const cached = this.subFolderCache.get(folderName);
    if (cached !== undefined) {
      return cached;
    }

    // 2. Buscar subpastas existentes
    const children = await this.listChildFolders(archiveId);
    for (const [name, id] of children) {
      this.subFolderCache.set(name, id);
    }

    // 3. Verificar se a pasta já existe após listar
    const existing = this.subFolderCache.get(folderName);
    if (existing !== undefined) {
      return existing;
    }

    // 4. Criar a subpasta
    const newId = await this.createChildFolder(archiveId, folderName);
    this.subFolderCache.set(folderName, newId);
    return newId;
  }

  /**
   * Garante que a pasta Archive existe no nível raiz das mailFolders.
   * Cria a pasta se necessário e cacheia o ID.
   */
  private async ensureArchiveFolder(): Promise<string> {
    if (this.archiveFolderId !== null) {
      return this.archiveFolderId;
    }

    const response = await this.client.get<GraphListResponse<MailFolder>>("/me/mailFolders", {
      $top: "50",
    });

    const archive = response.value.find((f) => f.displayName === "Archive");

    if (archive) {
      this.archiveFolderId = archive.id;
      logger.debug({ folderId: archive.id }, "Archive folder found");
      return archive.id;
    }

    // Criar a pasta Archive
    const created = await this.client.post<MailFolder>("/me/mailFolders", {
      displayName: "Archive",
    });

    this.archiveFolderId = created.id;
    logger.info({ folderId: created.id }, "Archive folder created");
    return created.id;
  }

  /**
   * Lista as subpastas de uma pasta pai.
   * Retorna um Map de displayName -> id.
   */
  private async listChildFolders(parentFolderId: string): Promise<Map<string, string>> {
    const response = await this.client.get<GraphListResponse<MailFolder>>(
      `/me/mailFolders/${parentFolderId}/childFolders`,
      { $top: "50" },
    );

    const map = new Map<string, string>();
    for (const folder of response.value) {
      map.set(folder.displayName, folder.id);
    }
    return map;
  }

  /**
   * Cria uma subpasta dentro de uma pasta pai.
   * Retorna o ID da nova pasta.
   */
  private async createChildFolder(parentFolderId: string, displayName: string): Promise<string> {
    const folder = await this.client.post<MailFolder>(
      `/me/mailFolders/${parentFolderId}/childFolders`,
      { displayName },
    );

    logger.info(
      {
        parentFolderId,
        displayName,
        folderId: folder.id,
        oldestFolderMaxYear: env.ARCHIVE_OLDEST_FOLDER_MAX_YEAR,
      },
      "Archive subfolder created",
    );

    return folder.id;
  }
}
