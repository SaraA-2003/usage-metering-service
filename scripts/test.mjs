import 'dotenv/config';
import postgres from 'postgres';
import { spawn } from 'node:child_process';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';

if (!process.env.DB_URL) throw new Error('DB_URL is required');
const source = new URL(process.env.DB_URL);
const testName = `${decodeURIComponent(source.pathname.slice(1))}_test`;
if (!/^[a-zA-Z0-9_]+$/.test(testName) || testName.length > 63) {
  throw new Error('Cannot derive a safe test database name from DB_URL');
}
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 1 });
try {
  const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${testName}`;
  if (!exists.length) await admin.unsafe(`CREATE DATABASE "${testName}"`);
} finally { await admin.end(); }
const testUrl = new URL(source);
testUrl.pathname = `/${testName}`;
const client = postgres(testUrl.toString(), { max: 1 });
try { await migrate(drizzle(client), { migrationsFolder: 'src/db/migrations' }); }
finally { await client.end(); }
console.log(`Running tests against dedicated database: ${testName}`);
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, DB_URL: testUrl.toString(), USAGE_TEST_DATABASE: testName },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
