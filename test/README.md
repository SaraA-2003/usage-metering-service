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
Direct SQL inserts bypass these application checks.
