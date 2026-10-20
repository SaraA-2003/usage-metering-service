import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { cpus, platform, release, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";

// Require the runner's isolated database and API instead of targeting a normal server.
const database = process.env.DB_URL ? decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)) : "";
if (!database.endsWith("_load_test") || process.env.USAGE_LOAD_DATABASE !== database || !process.env.API_URL) {
  throw new Error("Use npm run load-test to run against the isolated load-test API");
}
const baseUrl = process.env.API_URL;
function positiveSetting(name, fallback, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}
const totalRequests = positiveSetting("LOAD_REQUESTS", 1000, 1_000_000);
const concurrency = positiveSetting("LOAD_CONCURRENCY", 20, 500);
const accountCount = positiveSetting("LOAD_ACCOUNTS", 10, 100);

// Timeouts stop a stalled HTTP request from hanging the entire benchmark.
async function callApi(path, { method = "GET", body, apiKey } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, signal: AbortSignal.timeout(30000),
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(apiKey ? { "X-API-Key": apiKey } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return data;
}
const predefinedPlans = await callApi("/api/plans/predefined");
const accountPlan = predefinedPlans.find(plan => plan.type === "account" && plan.name === "Pro");
if (!accountPlan) throw new Error("Predefined Pro plan not found");

async function prepareLoadAccount(userCount, allowance = totalRequests) {
  const account = await callApi("/api/accounts", { method: "POST", body: { name: `Load test ${randomUUID()}`, planId: accountPlan.id } });
  // Explicit limits keep throughput runs free of quota rejections even with larger settings.
  const custom = await callApi("/api/plans", { method: "POST", apiKey: account.apiKey,
    body: { name: "Load shared plan", type: "account", monthlyAllowance: allowance, maxUnitsPerRequest: 1 } });
  await callApi(`/api/accounts/${account.id}/plan`, { method: "PATCH", apiKey: account.apiKey, body: { planId: custom.id } });
  const userPlan = await callApi("/api/plans", { method: "POST", apiKey: account.apiKey,
    body: { name: "Load user plan", type: "user", monthlyAllowance: totalRequests, maxUnitsPerRequest: 1 } });
  const users = [];
  for (let i = 0; i < userCount; i++) {
    users.push(await callApi("/api/users", { method: "POST", apiKey: account.apiKey, body: { planId: userPlan.id } }));
  }
  return { account, users };
}

async function sendConsumption(account, user) {
  const startedAt = performance.now();
  try {
    const result = await callApi("/api/consumptions", { method: "POST", apiKey: account.apiKey,
      body: { userId: user.id, units: 1, requestId: randomUUID() } });
    if (!["accepted", "rejected"].includes(result.outcome?.decision) || result.replayed !== false) {
      throw new Error("Unexpected consumption response");
    }
    return { accountId: account.id, userId: user.id, decision: result.outcome.decision,
      blockingLevel: result.outcome.blockingLevel, blockingRule: result.outcome.blockingRule,
      durationMs: performance.now() - startedAt };
  } catch (error) {
    return { error: error.message, durationMs: performance.now() - startedAt };
  }
}
async function runLoad(targets) {
  let nextRequest = 0;
  const results = [];
  async function worker() {
    while (nextRequest < totalRequests) {
      // Claim before awaiting; all workers share this counter in one JS process.
      const index = nextRequest++;
      const { account, user } = targets[index % targets.length];
      results.push(await sendConsumption(account, user));
    }
  }
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { results, elapsedMs: performance.now() - startedAt };
}
function summarizeLoad({ results, elapsedMs }) {
  // Include failed requests in latency measurements; expose failures separately.
  const durations = results.map(result => result.durationMs).sort((a, b) => a - b);
  const percentile = p => Number(durations[Math.ceil(durations.length * p) - 1].toFixed(2));
  return {
    attempted: results.length, accepted: results.filter(r => r.decision === "accepted").length,
    rejected: results.filter(r => r.decision === "rejected").length, errors: results.filter(r => r.error).length,
    elapsedMs: Math.round(elapsedMs), requestsPerSecond: Number((results.length * 1000 / elapsedMs).toFixed(2)),
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
  };
}
async function verifyUsage(groups, results) {
  for (const { account, users } of groups) {
    const own = results.filter(r => r.accountId === account.id);
    const accepted = own.filter(r => r.decision === "accepted").length;
    const usage = await callApi(`/api/accounts/${account.id}/usage`, { apiKey: account.apiKey });
    if (usage.consumedUnits !== accepted) throw new Error("Account usage does not match accepted units");
    for (const user of users) {
      const expected = own.filter(r => r.userId === user.id && r.decision === "accepted").length;
      const saved = await callApi(`/api/users/${user.id}/usage`, { apiKey: account.apiKey });
      if (saved.consumedUnits !== expected) throw new Error("User usage does not match accepted units");
    }
    // Verify both accepted and rejected requests are retained in paginated history.
    let count = 0;
    let offset = 0;
    do {
      const page = await callApi(`/api/consumptions/history?limit=100&offset=${offset}`, { apiKey: account.apiKey });
      count += page.requests.length;
      offset = page.nextOffset;
    } while (offset !== null);
    if (count !== own.length) throw new Error("History count mismatch");
  }
}

const summaries = {};
for (const scenario of ["sharedAccount", "multipleAccounts", "sharedQuotaBoundary"]) {
  const groups = [];
  const quota = Math.max(1, Math.floor(totalRequests / 10));
  const count = scenario === "multipleAccounts" ? accountCount : 1;
  // Setup and verification are excluded from the timed consumption workload.
  for (let i = 0; i < count; i++) groups.push(await prepareLoadAccount(scenario === "multipleAccounts" ? 1 : 10,
    scenario === "sharedQuotaBoundary" ? quota : totalRequests));
  const targets = groups.flatMap(({ account, users }) => users.map(user => ({ account, user })));
  console.log(`Running ${scenario}: ${totalRequests} requests, concurrency ${concurrency}`);
  const run = await runLoad(targets);
  const summary = summarizeLoad(run);
  if (summary.errors) throw new Error(`${scenario}: ${summary.errors} errors; ${run.results.find(r => r.error).error}`);
  const expectedAccepted = scenario === "sharedQuotaBoundary" ? quota : totalRequests;
  if (summary.accepted !== expectedAccepted || summary.rejected !== totalRequests - expectedAccepted) {
    throw new Error(`${scenario}: unexpected accepted/rejected totals`);
  }
  if (run.results.some(r => r.decision === "rejected" && (r.blockingLevel !== "account" || r.blockingRule !== "monthly_allowance"))) {
    throw new Error("Incorrect quota rejection reason");
  }
  await verifyUsage(groups, run.results);
  summaries[scenario] = { ...summary, accountingVerified: true };
  console.table({ [scenario]: summary });
}
// Persist reproducible metadata and measurements, never account keys or DB credentials.
const report = {
  recordedAt: new Date().toISOString(), mode: "local isolated API via tsx; PostgreSQL from DB_URL",
  runtime: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, memoryGiB: Number((totalmem() / 1024 ** 3).toFixed(2)),
  totalRequests, concurrency, accountCount, scenarios: summaries,
};
await mkdir("load-results", { recursive: true });
await writeFile("load-results/latest.json", JSON.stringify(report, null, 2) + "\n");
console.log("All accounting checks passed. Measurements saved to load-results/latest.json");
