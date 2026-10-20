# Automated tests

[Project overview](../README.md) · [Load testing](../LOAD_TESTING.md)

Run integration tests with `npm test` (or `npm test -- test/plans.test.ts`).

The runner reads the existing DB_URL, PLATFORM, and PORT configuration. It derives
a separate database by appending `_test` to the application database name, creates
it if missing, and applies the checked-in migrations before running Vitest.
The PostgreSQL role must be able to create that database on its first run.
No additional .env variables are required.

The suites truncate application tables only in that dedicated test database, both
before setup and during teardown. A Vitest setup guard rejects direct runs without
the test runner's database marker. Normal teardown cleans fixtures even after a
failed assertion; forcibly killing the process can interrupt cleanup, and the next
run clears leftovers. Never store non-test data in the derived test database.

Plan name concurrency checks cover API creates and renames. They use a transaction
advisory lock per account to keep normalized-name checks and writes together.
Unique indexes additionally protect normalized predefined names by type and custom
names by account/type. Direct SQL still bypasses the API reservation preventing
custom names from matching predefined names.


## Coverage

The suites cover API authentication and isolation, plans and switches, all four
consumption rules, accepted/rejected history, idempotent retries and conflicts,
concurrent consumption, current/historical usage, pagination, startup seeding,
concurrent seed calls, normalized plan uniqueness, encrypted session storage,
browser-scoped saved accounts, and a simulated browser lost-response retry.

```bash
# Run all tests or select one file through the safe runner.
npm run test
npm test -- test/consumptions.test.ts
```

Tests using session stores generate temporary encryption keys; they do not need the
real client encryption key. Browser retry tests simulate the DOM in Node; they are
not a complete real-browser end-to-end suite. Running tests requires a local
PostgreSQL server even if the normal application is otherwise run with Compose.
The default DB_URL used by local tests must be reachable from the host.
