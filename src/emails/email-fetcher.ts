import { env } from "../config/env.js";
import { GraphClient } from "../graph/graph-client.js";
import type { MailFolder, OutlookMessage } from "../graph/graph-types.js";
import logger from "../utils/logger.js";
import { getCurrentYear } from "../utils/dates.js";
import type { FetchOptions } from "./email-types.js";

const SELECT_FIELDS = [
  "id",
  "internetMessageId",
  "conversationId",
  "subject",
  "from",
  "receivedDateTime",
  "importance",
  "isRead",
  "flag",
  "categories",
  "parentFolderId",
].join(",");

export class EmailFetcher {
  constructor(private readonly client: GraphClient) {}

  /**
   * Returns the ID of the Inbox mail folder.
   */
  async getInboxId(): Promise<string> {
    const folder = await this.client.get<MailFolder>("/me/mailFolders/Inbox");
    return folder.id;
  }

  /**
   * Fetches messages from the Inbox with automatic pagination.
   * Calls onPage for each batch of messages.
   * Respects FetchOptions (year, before, limit).
   */
  async fetchMessages(
    options: FetchOptions,
    onPage: (messages: OutlookMessage[]) => Promise<void>,
  ): Promise<{ total: number }> {
    const inboxId = await this.getInboxId();

    const filter = buildFilter(options);

    logger.info({ filter, options }, "Starting email fetch");

    let total = 0;
    let limitReached = false;

    await this.client.paginate<OutlookMessage>(
      `/me/mailFolders/${inboxId}/messages`,
      {
        $select: SELECT_FIELDS,
        $orderby: "receivedDateTime asc",
        $top: String(env.PAGE_SIZE),
        ...(filter ? { $filter: filter } : {}),
      },
      async (messages) => {
        if (limitReached) return;

        let batch = messages;

        if (options.limit !== undefined) {
          const remaining = options.limit - total;
          if (remaining <= 0) {
            limitReached = true;
            return;
          }
          if (batch.length > remaining) {
            batch = batch.slice(0, remaining);
            limitReached = true;
          }
        }

        logger.info(
          { pageSize: batch.length, totalSoFar: total + batch.length },
          "Processing email page",
        );

        await onPage(batch);
        total += batch.length;
      },
    );

    logger.info({ total }, "Email fetch complete");

    return { total };
  }
}

function buildFilter(options: FetchOptions): string | undefined {
  if (options.year !== undefined) {
    const year = options.year;
    return (
      `receivedDateTime ge ${year}-01-01T00:00:00Z` +
      ` and receivedDateTime lt ${year + 1}-01-01T00:00:00Z`
    );
  }

  if (options.before !== undefined) {
    return `receivedDateTime lt ${options.before.toISOString()}`;
  }

  const currentYear = getCurrentYear();
  return `receivedDateTime lt ${currentYear}-01-01T00:00:00Z`;
}
