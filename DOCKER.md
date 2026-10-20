# Docker Compose guide

[Project overview](README.md) · [API reference](docs/API.md)

## Setup and startup

Copy `.env.example` to `.env` and set `SESSION_ENCRYPTION_KEY` to 64 random hex
characters before starting. Keep that key stable across restarts. Docker Compose
provides DB_URL and PLATFORM internally; PORT controls the published API port.

Run from the repository root:

```bash
docker compose up --build
```

Stop local API/client processes first if they occupy ports 8080 or 3000. Open
http://localhost:3000. The API is available on localhost at the PORT from .env
(default 8080). The .env SESSION_ENCRYPTION_KEY must remain stable so saved
accounts can be decrypted after restarts. Neither .env nor its contents are copied
into the image; the key is supplied to the client container at runtime.

Compose starts PostgreSQL, waits for readiness, applies checked-in migrations,
then starts the compiled API (which seeds predefined plans). The client waits for
the API to become healthy. An exited migration container with exit code 0 is normal.
The same image includes tsx and drizzle-kit for client execution and migrations.

Compose supplies its own DB_URL pointing to the db service; your WSL database
and the DB_URL in .env are unchanged. PostgreSQL is not exposed on a host port.
Local demo database credentials are defined in compose.yaml.

```bash
docker compose down
```

This stops containers while preserving the named PostgreSQL volume, accounts,
and encrypted sessions. `docker compose down -v` also deletes that volume and
all Compose database data; use it only when you intend to reset everything.


## Everyday commands

Run these from the repository root (where `compose.yaml` is):

```bash
# Run in the background; rebuild when source code changes.
docker compose up --build -d

# Inspect services and recent logs.
docker compose ps
docker compose logs --tail=100 api client migrate

# List built images.
docker compose images

# Open PostgreSQL inside the database container.
docker compose exec db psql -U usage -d usage_metering
```

Inside psql, use `\dt` to list tables and `\q` to exit. PostgreSQL has no published
host port; use `docker compose exec` for direct access.

## Services and storage

| Service | Role |
| --- | --- |
| `db` | PostgreSQL 17; persistent named volume |
| `migrate` | One-off schema migration; exits successfully before API startup |
| `api` | Compiled API on container port 8080; seeds missing plans |
| `client` | Example client server on port 3000; API_URL points to `http://api:8080` |

Compose builds application images from the repository using the Dockerfile. Sending
only the Dockerfile and YAML to another developer is insufficient: source files and
the lockfile are required. Images are not published to a registry by this setup.

Local demo database credentials are checked into Compose for reproducibility; use
appropriate secret management before deploying beyond local/demo use. The image
runs as the non-root Node user, but includes development tools needed for migrations
and TypeScript client execution. It is not a minimized production image.

## Troubleshooting

- **No configuration file provided:** change to the repository root or use
  `docker compose -f /path/to/compose.yaml ...`.
- **Port already allocated:** stop local API/client processes using the same ports.
- **Missing encryption key:** fill in SESSION_ENCRYPTION_KEY in `.env`.
- **No old local accounts:** Docker has a separate database, not your WSL database.
- **Code changes not visible:** rerun `docker compose up --build`.
- **Migration failure:** inspect `docker compose logs migrate`; migrations stop
  startup rather than deleting conflicting existing records.
- **Saved accounts unavailable:** retain both browser cookies and the encryption
  key. Connections expire after seven days; see the web client guide.

The `.dockerignore` excludes `.env`, local dependencies, build output, and Git
history. AGENTS.md is not copied by the Dockerfile. Do not put secrets in source
files or Docker build arguments.
