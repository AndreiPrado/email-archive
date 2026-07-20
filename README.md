# email-archive

CLI script to archive Microsoft Outlook emails by year using the Microsoft Graph API. Built to clean up inboxes with thousands of old emails — tested on an inbox with over 13,000 messages.

## What it does

Reads your Outlook Inbox and moves old emails into yearly archive folders:

```
Archive/
├── 2015 e anteriores
├── 2016
├── 2017
├── ...
└── 2025
```

Emails from the current year are never touched. Flagged emails and high-importance emails are skipped by default (configurable). All operations are idempotent — safe to run multiple times.

## Features

- **Dry run mode** — preview what would be moved without changing anything
- **Year-by-year processing** — archive one year at a time
- **Batch API** — moves up to 20 emails per request for efficiency
- **Throttling handled** — respects `Retry-After` headers with exponential backoff
- **Idempotent** — skips already-moved emails; resumes after interruption
- **SQLite state tracking** — persists processing state locally
- **Immutable IDs** — uses Microsoft Graph immutable IDs to prevent stale references
- **Non-destructive** — never deletes emails; preserves `isRead`, flags, categories, and importance

## Tech stack

- Node.js 20+ / TypeScript
- Microsoft Graph API (OAuth 2.0 Device Code Flow)
- SQLite via `better-sqlite3`
- Zod, Pino, Vitest

## Setup

### 1. Register an app in Microsoft Entra ID

1. Go to [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Set **Supported account types** to "Accounts in any organizational directory and personal Microsoft accounts"
3. Add redirect URI: `Web` → `http://localhost:3000/auth/callback`
4. Under **API permissions**, add delegated permissions: `Mail.ReadWrite`, `User.Read`, `offline_access`
5. Under **Authentication**, enable **Allow public client flows**

> For **personal Microsoft accounts** (Outlook.com, Hotmail), set `MICROSOFT_TENANT_ID=consumers` in your `.env`.

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your app credentials:

```env
MICROSOFT_CLIENT_ID=your-client-id-here
MICROSOFT_TENANT_ID=consumers        # or "common" for work accounts
MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/callback

DATABASE_URL=file:./data/email-archive.db
LOG_LEVEL=info

BATCH_SIZE=10
PAGE_SIZE=250
MAX_CONCURRENCY=1
MAX_RETRIES=5

ARCHIVE_OLDEST_FOLDER_MAX_YEAR=2015  # emails up to this year go into "YYYY e anteriores"
```

> **Note on concurrency:** Personal Microsoft accounts have strict mailbox concurrency limits. Use `BATCH_SIZE=10` and `MAX_CONCURRENCY=1` to avoid `429 MailboxConcurrency` errors.

### 3. Install dependencies

```bash
npm install
```

### 4. Authenticate

```bash
npm run auth
```

Opens a browser-based Device Code Flow — no passwords stored. A `tokens.json` file is created locally (gitignored) and refreshed automatically.

## Usage

### Dry run (no changes made)

```bash
npm run archive-emails -- --dry-run
```

Shows a count of emails per year and which would be skipped. Always run this first.

### Archive by year

```bash
npm run archive-emails -- --year=2023
npm run archive-emails -- --year=2024
npm run archive-emails -- --year=2025
```

### Archive everything before a date

```bash
npm run archive-emails -- --before=2016-01-01
```

### Test with a small batch first

```bash
npm run archive-emails -- --year=2023 --limit=20
```

### Skip confirmation prompt (for automation)

```bash
npm run archive-emails -- --year=2023 --yes
```

### All options

| Option | Description |
|---|---|
| `--dry-run` | Preview only, no moves |
| `--year=YYYY` | Process only a specific year |
| `--before=YYYY-MM-DD` | Process emails before this date |
| `--limit=N` | Cap the number of emails processed |
| `--include-flagged` | Also move flagged emails (skipped by default) |
| `--include-high-importance` | Also move high-importance emails (skipped by default) |
| `--resume` | Retry only previously failed emails |
| `--verbose` | Enable debug logging |
| `--yes` | Skip the confirmation prompt |

## Recommended workflow for large inboxes

```bash
# 1. Preview everything
npm run archive-emails -- --dry-run

# 2. Test with a small batch
npm run archive-emails -- --year=2023 --limit=20

# 3. Archive year by year
npm run archive-emails -- --year=2023
npm run archive-emails -- --year=2024
npm run archive-emails -- --year=2025

# 4. Archive older emails
npm run archive-emails -- --before=2023-01-01
```

## Security

- Credentials are stored only in `.env` (gitignored)
- OAuth tokens are stored only in `tokens.json` (gitignored)
- Email content is never downloaded (only metadata: subject, sender, date, flags)
- Emails are never deleted — only moved between folders
- Access can be revoked anytime at [account.microsoft.com](https://account.microsoft.com) → Security → Connected apps

## Development

```bash
npm run typecheck    # TypeScript type check
npm run test:run     # Run unit tests
npm run lint         # ESLint
npm run format       # Prettier
```

## Project structure

```
src/
├── auth/           # OAuth Device Code Flow, token storage
├── cli/            # CLI entry points (auth, archive-emails)
├── config/         # Environment validation (Zod)
├── emails/         # EmailFetcher, ArchivePolicy, MoveService
├── folders/        # FolderService (create/resolve archive folders)
├── graph/          # GraphClient, retry logic, types
├── persistence/    # SQLite database, migrations, repository
├── reports/        # Run report generation
└── utils/          # Logger, date helpers, concurrency
tests/
├── archive-policy.test.ts
└── graph-retry.test.ts
```

## License

MIT
