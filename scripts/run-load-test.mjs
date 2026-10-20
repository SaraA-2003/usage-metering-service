import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { spawn } from "node:child_process";
import { once } from "node:events";

// Derive a dedicated database; never modify the application's connection settings.
if (!process.env.DB_URL) throw new Error("DB_URL is required");
const loadDatabaseUrl = new URL(process.env.DB_URL);
const applicationDatabaseName = decodeURIComponent(loadDatabaseUrl.pathname.slice(1));
const loadDatabaseName = `${applicationDatabaseName}_load_test`;
if (!/^[a-zA-Z0-9_]+$/.test(loadDatabaseName) || loadDatabaseName.length > 63) {
  throw new Error("Cannot derive a safe load-test database name");
}
loadDatabaseUrl.pathname = `/${loadDatabaseName}`;
const adminUrl = new URL(process.env.DB_URL);
adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 1 });
try {
  const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${loadDatabaseName}`;
  if (!existing.length) await admin.unsafe(`CREATE DATABASE "${loadDatabaseName}"`);
} finally { await admin.end(); }

const client = postgres(loadDatabaseUrl.toString(), { max: 1 });
let api;
let load;
let locked = false;

// This list is deliberately limited to the isolated benchmark database.
async function clearData() {
  await client`TRUNCATE TABLE client_sessions, consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(force); }
}
// Interrupts still reach finally so the API stops and fixtures are removed.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { void stop(load); void stop(api); });
}
try {
  // Fail rather than interfering with another benchmark using this database.
  const [lock] = await client`SELECT pg_try_advisory_lock(73124, 2) AS acquired`;
  if (!lock.acquired) throw new Error("Another load test is already running");
  locked = true;
  await migrate(drizzle(client), { migrationsFolder: "src/db/migrations" });
  await clearData();
  const environment = { ...process.env, DB_URL: loadDatabaseUrl.toString(), PLATFORM: "load-test", PORT: "0" };

  // Port 0 picks an unused port. IPC reports the actual address without guessing or racing.
  api = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { app } from './src/app.ts';
    import { seedPredefinedPlans } from './src/db/seed.ts';
    await seedPredefinedPlans();
    const server = app.listen(0, '127.0.0.1', () => {
      process.send({ port: server.address().port });
    });
  `], { env: environment, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("API startup timed out")), 30000);
    api.once("error", error => { clearTimeout(timeout); reject(error); });
    api.once("exit", code => { clearTimeout(timeout); reject(new Error(`API exited: ${code}`)); });
    api.once("message", message => { clearTimeout(timeout); resolve(message.port); });
  });
  console.log(`Load database: ${loadDatabaseName}; API: http://127.0.0.1:${port}`);
  load = spawn(process.execPath, ["scripts/load-test.mjs"], {
    stdio: "inherit", env: { ...environment, API_URL: `http://127.0.0.1:${port}`, USAGE_LOAD_DATABASE: loadDatabaseName },
  });
  const code = await new Promise((resolve, reject) => {
    load.once("error", reject);
    load.once("exit", (code, signal) => resolve(signal ? 1 : code));
  });
  if (code !== 0) throw new Error(`Load test failed (exit ${code})`);
} finally {
  // No benchmark data survives a normal success, failure, or interrupt.
  await stop(load);
  await stop(api);
  try {
    if (locked) {
      await clearData();
      const [counts] = await client`SELECT (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM consumption_requests) AS outcomes`;
      console.log(`Cleanup verified: ${counts.accounts} accounts, ${counts.outcomes} outcomes`);
    }
  } finally {
    if (locked) await client`SELECT pg_advisory_unlock(73124, 2)`;
    await client.end();
  }
}
