import { z } from "zod";

const envSchema = z.object({
  MICROSOFT_CLIENT_ID: z.string().min(1, "MICROSOFT_CLIENT_ID is required"),
  MICROSOFT_TENANT_ID: z.string().default("common"),
  MICROSOFT_REDIRECT_URI: z.string().default("http://localhost:3000/auth/callback"),
  DATABASE_URL: z.string().default("file:./data/email-archive.db"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  BATCH_SIZE: z.coerce.number().default(20),
  PAGE_SIZE: z.coerce.number().default(250),
  MAX_CONCURRENCY: z.coerce.number().default(2),
  MAX_RETRIES: z.coerce.number().default(5),
  ARCHIVE_OLDEST_FOLDER_MAX_YEAR: z.coerce.number().default(2022),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
