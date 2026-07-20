import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import logger from "../utils/logger.js";

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp em ms
  tokenType: string;
  scope: string;
}

// tokens.json fica na raiz do projeto (dois níveis acima de src/auth/)
const TOKEN_FILE_PATH = fileURLToPath(new URL("../../tokens.json", import.meta.url));

export async function saveTokens(tokens: TokenData): Promise<void> {
  await writeFile(TOKEN_FILE_PATH, JSON.stringify(tokens, null, 2), "utf-8");
  logger.debug({ path: TOKEN_FILE_PATH }, "Tokens saved");
}

export async function loadTokens(): Promise<TokenData | null> {
  try {
    const content = await readFile(TOKEN_FILE_PATH, "utf-8");
    const data = JSON.parse(content) as TokenData;
    logger.debug({ path: TOKEN_FILE_PATH }, "Tokens loaded");
    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug("Token file not found");
      return null;
    }
    throw err;
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await unlink(TOKEN_FILE_PATH);
    logger.debug({ path: TOKEN_FILE_PATH }, "Tokens cleared");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug("Token file does not exist, nothing to clear");
      return;
    }
    throw err;
  }
}
