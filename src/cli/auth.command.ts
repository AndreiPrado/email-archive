import { loadTokens } from "../auth/token-store.js";
import { authenticate } from "../auth/auth-service.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const tokens = await loadTokens();

  if (tokens) {
    const isValid = tokens.expiresAt - FIVE_MINUTES_MS > Date.now();

    if (isValid) {
      const expiresAt = new Date(tokens.expiresAt).toISOString();
      console.log(`Já autenticado. Token válido até ${expiresAt}`);
      return;
    }
  }

  await authenticate();
}

main().catch((err: unknown) => {
  console.error(
    "Erro durante autenticação:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
