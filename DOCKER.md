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
