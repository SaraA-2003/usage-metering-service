# Usage Metering Service

A backend API for tracking and enforcing usage quotas for one resource: **units**.
Each application is an account with a shared account plan. Its users have their
own user plans. Consumption must satisfy both plans, and every accepted or
quota-rejected outcome is recorded.

Built with TypeScript, Node.js 22, Express, PostgreSQL, Drizzle ORM, and Zod.
Includes an example web client, automated integration tests, and reproducible load tests.

## Features

- Account API keys, stored as hashes, with account isolation.
- Read-only predefined plans and account-owned custom plans.
- Monthly allowances and maximum units per request at account and user levels.
- Plan updates and switches preserve consumed usage.
- Atomic consumption with PostgreSQL transactions and account row locks.
- Account-scoped request IDs for safe retries and payload-conflict detection.
- UTC monthly accounting, historical usage, and paginated request history.
- Web client with encrypted server-side saved accounts and Previous/Next pagination.

## Installation and quick start

Clone the repository using the commands below.

```bash
git clone https://github.com/SaraA-2003/usage-metering-service.git usage-metering
cd usage-metering
```

Then choose Docker Compose or local development.

### Docker Compose

Requires Docker Engine/Desktop with Compose. No host Node.js or PostgreSQL install
is needed for this path.

1. Copy `.env.example` to `.env`.
2. Replace `SESSION_ENCRYPTION_KEY` with a random 64-character hexadecimal key.
   If Node.js is installed, generate one with:

   ```bash
   # Generate once; save the output in .env and keep it stable.
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Without host Node.js, use Docker:

   ```bash
   # Generate a key using a temporary Node container.
   docker run --rm node:22-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Start the stack:

   ```bash
   docker compose up --build
   ```

Open **http://localhost:3000**. The API is published at **http://localhost:8080**
with the example configuration. Stop any local processes already using those ports.
Compose waits for PostgreSQL, runs migrations, starts/seeds the API, then starts
the client. It uses a separate database in a persistent Docker volume.

See the [Docker guide](DOCKER.md) for commands, database access, and troubleshooting.

### Local development

Requires Node.js 22 (see `.nvmrc`), npm, and a running PostgreSQL instance. Create
an empty application database and a role that can access it.

```bash
# If using nvm, select the project's Node version.
nvm use
npm ci
cp .env.example .env
```

Update `.env` with your PostgreSQL credentials and a generated encryption key:

| Variable | Purpose |
| --- | --- |
| `DB_URL` | PostgreSQL connection URL for local API/client |
| `PORT` | API port, normally `8080` |
| `PLATFORM` | Required environment label, such as `local` |
| `SESSION_ENCRYPTION_KEY` | 32-byte key encoded as 64 hex characters; required by the web client |

```bash
# Create/update the application schema, then start the API.
npm run migrate
npm run dev
```

In a second terminal:

```bash
# Start the example client on port 3000.
npx tsx examples/web/server.ts
```

The API seeds missing predefined plans before listening. To run compiled API code:

```bash
npm run build
npm start
```

`.env` is ignored by Git and excluded from Docker builds. Never commit actual
credentials or API keys. Optional `API_URL` overrides the client server's upstream
API address; Compose sets it automatically.

## API endpoints

Public bootstrap endpoints discover predefined plans and create accounts. Other
account/user/plan/consumption endpoints require `X-API-Key`.

See the [API reference](docs/API.md) for every route, request/response schemas,
curl examples, validation, errors, retries, and a reproducible demonstration.

## Example web client

Create an account, register users on different plans, consume units, inspect
account usage, switch user plans, and browse/filter consumption history. Saved
accounts belong to the browser and can be reopened after server restarts.

See the [web client guide](examples/web/README.md) for setup, session behavior,
key handling, and interface limitations.

## Automated tests

```bash
npm test
# npm run test is equivalent.
```

The runner creates/migrates a dedicated database derived from DB_URL with `_test`
appended. It refuses direct test execution against the application database.
The role needs permission to create the test database on first use. Tests clean
up their fixtures after execution.

See the [test guide](test/README.md) for isolation, coverage, and cleanup details.

## Load testing

```bash
npm run load-test
```

This creates a separate `_load_test` database and temporary API, runs shared-account,
multiple-account, and quota-boundary workloads, verifies accounting/history, then
cleans up. It does not benchmark your already-running Docker API.

See the [load-test guide](LOAD_TESTING.md) for configuration, measured results,
environment details, limitations, and bottleneck observations.

## Design decisions and limitations

- Monthly usage is keyed by account/month and user/month. No reset job is required.
- Account rules are checked first: per-request, monthly, then user per-request and monthly.
- Request IDs are unique per account across months; identical retries return saved
  decisions, including rejections. Changed user/units returns 409.
- Historical usage uses historical totals and **current** plan limits; plan snapshots
  are not stored. Future months are rejected.
- Existing plan definitions are preserved during startup seeding. Custom edits
  affect subsequent new requests; switching plans never resets usage.
- One account row lock serializes its consumption transactions. This protects shared
  quotas but limits throughput for a single busy account.
- Names are normalized for plan uniqueness, scoped by owner and type. Predefined
  names are reserved by the API for the same type. Account names need not be unique.
- Account creation is public bootstrap and issues a key once. No key-recovery,
  rotation, deletion, or end-user-login endpoints are implemented.
- The web client saves encrypted keys separately from API key hashes. Session/browser
  cookies and saved connections expire; losing cookies or the encryption key can
  lose client access. This is an example client, not an identity-management system.
- Offset history pages can shift if new requests arrive while browsing.
- Application schema initialization is automatic in Compose; local startup requires
  `npm run migrate` first.

Billing, payments, refunds, multiple resources, end-user login, RBAC, and distributed
infrastructure are outside scope.

## Project layout

```text
src/                 API handlers, services, queries, schema, migrations, seeding
examples/web/        Client server and browser interface
scripts/             Isolated test/load-test runners
test/                Integration and browser-simulation regression tests
docs/API.md          HTTP API reference and demonstration
compose.yaml         PostgreSQL, migrations, API, and client services
```
