# Load testing

[Project overview](README.md) · [Automated tests](test/README.md) · [Docker guide](DOCKER.md)

Run from the repository root after `npm ci`:

```bash
npm run load-test
```

No API process needs to be running. The runner reads the existing DB_URL,
creates a separate database with `_load_test` appended to its name, applies
migrations, and starts a temporary API on an unused localhost port. The
PostgreSQL role needs CREATE DATABASE permission on the first run. It keeps the
application database and the automated `_test` database untouched. It refuses a
second simultaneous benchmark against the same load database.

The runner removes all fixture data in that dedicated load database before and
after the run and stops the temporary API, including on normal failures and
SIGINT/SIGTERM. Never put non-benchmark data in this database. A forced kill or
machine crash can interrupt cleanup; the next run clears leftovers. The empty
database and its schema remain available for reuse.

## Configuration

Defaults: 1,000 requests per scenario, 20 concurrent workers, and 10 accounts in
the multiple-account scenario. Override without changing `.env`:

```bash
LOAD_REQUESTS=2000 LOAD_CONCURRENCY=40 LOAD_ACCOUNTS=10 npm run load-test
```

Custom plans allow all requests in the throughput scenarios. Each new request
has a unique request ID and consumes one unit. Setup and verification are outside
the timer. Each worker sends another request only after its previous one completes
(a closed-loop workload); this is not a fixed arrival-rate test. Requests time out
after 30 seconds. Failures cause a nonzero exit, rather than reporting success.

The runner executes:

1. One account, ten users: contention on one shared account lock.
2. Ten accounts, one user each: independent account locks.
3. One account, ten users, allowance of 10% of request count (minimum one): checks
   concurrent quota enforcement, including saved rejected outcomes.

For each account and user, stored usage must equal accepted one-unit requests.
Paginated history counts must match all returned decisions. The quota scenario
must accept exactly its allowance and reject the rest with an account monthly
allowance reason. Latency includes the complete HTTP request, JSON parsing, and
any failures. Throughput counts all completed attempts.

## Measured run

The first measured local run used 1,000 requests per scenario and 20 workers:

| Scenario | Accepted | Rejected | HTTP/network errors | Requests/s | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Shared account | 1,000 | 0 | 0 | 77.17 | 255.30 | 302.84 | 356.45 |
| Ten accounts | 1,000 | 0 | 0 | 212.39 | 92.89 | 114.28 | 124.61 |
| Shared allowance of 100 | 100 | 900 | 0 | 98.04 | 201.52 | 242.67 | 280.00 |

All accounting/history checks passed. Cleanup confirmed zero accounts and request
outcomes afterward. `load-results/latest.json` contains the timestamp, Node/OS/CPU
metadata, settings, and exact results. Each successful run overwrites that file;
copy it elsewhere before rerunning if you want to retain a comparison.

## Observations and limits

Ten accounts achieved about 2.75 times the throughput of one shared account in
this run. This is consistent with serialization on the shared account lock: same
account requests wait for each other, whereas separate accounts can proceed
concurrently. Rejection-heavy traffic was faster than accepted shared-account
traffic, consistent with skipping usage writes. These are inferences, not profiler
measurements. The queries per transaction, database connection pool, local network,
and disk can also limit performance.

This is one local run using tsx and the PostgreSQL connection derived from DB_URL,
not a Docker benchmark or a production capacity claim. No explicit warmup or
repeat-run averaging was performed; startup, caches, other processes, and the
load generator sharing the host can affect results. Future comparisons should use
the same environment, repeat runs, vary concurrency, and profile before changing
locking or pool settings. Docker Compose runtime measurements remain separate.
