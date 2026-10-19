import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { app } from "../src/app.js";
import { db } from "../src/db/index.js";
import { accounts, plans, accountMonthlyUsage } from "../src/db/schema.js";
import { hashApiKey } from "../src/auth.js";

let server: Server | undefined;
let baseUrl: string;
let accountPlanId: string;
let userPlanId: string;
let customPlanId: string;

// Clears the application tables in DB_URL before inserting test fixtures.
beforeAll(async () => {
  await db.execute(sql`TRUNCATE TABLE consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
  const [accountPlan] = await db.insert(plans).values({
    name: "Test account plan", type: "account", isPredefined: true,
    monthlyAllowance: 1000, maxUnitsPerRequest: 100,
  }).returning();
  accountPlanId = accountPlan!.id;
  const [userPlan] = await db.insert(plans).values({
    name: "Test user plan", type: "user", isPredefined: true,
    monthlyAllowance: 100, maxUnitsPerRequest: 10,
  }).returning();
  userPlanId = userPlan!.id;
  const [owner] = await db.insert(accounts).values({
    name: "Custom plan owner", planId: accountPlanId,
    apiKeyHash: hashApiKey("fixture-owner-key"),
  }).returning();
  const [customPlan] = await db.insert(plans).values({
    name: "Custom account plan", type: "account", isPredefined: false,
    accountId: owner!.id, monthlyAllowance: 2000, maxUnitsPerRequest: 200,
  }).returning();
  customPlanId = customPlan!.id;
  // Port 0 asks the OS for an available port; no separate API server is needed.
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 15000);

afterAll(async () => {
  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
        server!.closeAllConnections();
      });
    }
  } finally {
    try {
      await db.execute(sql`TRUNCATE TABLE consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
    } finally {
      await db.$client.end();
    }
  }
});

function createAccountRequest(body: unknown) {
  return fetch(`${baseUrl}/api/accounts`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/accounts", () => {
  it("creates an account using a predefined account plan and stores only the key hash", async () => {
    const res = await createAccountRequest({ name: "New application", planId: accountPlanId });
    expect(res.status).toBe(201);
    const account = await res.json();
    expect(account).toMatchObject({ name: "New application", planId: accountPlanId });
    expect(account.apiKey).toMatch(/^ums_[a-f0-9]{64}$/);
    expect(account).not.toHaveProperty("apiKeyHash");
    const [stored] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(stored).toMatchObject({ name: "New application", planId: accountPlanId,
      apiKeyHash: hashApiKey(account.apiKey) });
  });

  for (const scenario of [
    { name: "a user plan", planId: () => userPlanId, status: 400,
      message: "Accounts must be assigned an account plan, not a user plan" },
    { name: "a custom account plan", planId: () => customPlanId, status: 400,
      message: "New accounts must be assigned a predefined plan" },
    { name: "a nonexistent plan", planId: () => randomUUID(), status: 404,
      message: "The requested plan was not found" },
  ]) {
    it(`rejects ${scenario.name} without creating an account`, async () => {
      const before = await db.select().from(accounts);
      const res = await createAccountRequest({ name: "Rejected application", planId: scenario.planId() });
      expect(res.status).toBe(scenario.status);
      expect(await res.json()).toEqual({ error: scenario.message });
      expect(await db.select().from(accounts)).toHaveLength(before.length);
    });
  }

  it.each([
    undefined, {}, { name: "Example" }, { name: 123, planId: randomUUID() },
    { name: " ", planId: randomUUID() }, { name: "a".repeat(256), planId: randomUUID() },
    { name: "Example", planId: "invalid" },
    { name: "Example", planId: randomUUID(), apiKeyHash: "client-provided" },
  ])("rejects invalid body %j without creating an account", async (body) => {
    const before = await db.select().from(accounts);
    const res = await createAccountRequest(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(await db.select().from(accounts)).toHaveLength(before.length);
  });
});

describe("GET /api/accounts/:id", () => {
  it("returns the authenticated account without its key hash", async () => {
    const [owner] = await db.select().from(accounts)
      .where(eq(accounts.apiKeyHash, hashApiKey("fixture-owner-key")));
    const res = await fetch(`${baseUrl}/api/accounts/${owner!.id}`, {
      headers: { "X-API-Key": "fixture-owner-key" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: owner!.id, planId: accountPlanId });
    expect(body).not.toHaveProperty("apiKeyHash");
    expect(body).not.toHaveProperty("apiKey");
  });

  it.each([null, "wrong-key"])("returns 401 for key %s", async (key) => {
    const res = await fetch(`${baseUrl}/api/accounts/${randomUUID()}`, {
      headers: key === null ? {} : { "X-API-Key": key },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });

  it("returns 404 when a valid key targets another existing account", async () => {
    const [other] = await db.insert(accounts).values({
      name: "Other account", planId: accountPlanId, apiKeyHash: hashApiKey("other-lookup-key"),
    }).returning();
    const res = await fetch(`${baseUrl}/api/accounts/${other!.id}`, {
      headers: { "X-API-Key": "fixture-owner-key" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Account not found" });
  });

  it("returns 400 for an invalid account UUID", async () => {
    const res = await fetch(`${baseUrl}/api/accounts/invalid`, {
      headers: { "X-API-Key": "fixture-owner-key" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Account ID must be a valid UUID" });
  });
});

describe("PATCH /api/accounts/:id/plan", () => {
  async function fixture() {
    const apiKey = `switch-${randomUUID()}`;
    const [account] = await db.insert(accounts).values({
      name: "Switch plan account", planId: accountPlanId, apiKeyHash: hashApiKey(apiKey),
    }).returning();
    return { account: account!, apiKey };
  }

  function switchPlan(id: string, body: unknown, apiKey: string | null) {
    return fetch(`${baseUrl}/api/accounts/${id}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
      body: JSON.stringify(body),
    });
  }

  it.each([true, false])("assigns an allowed plan (predefined: %s) and preserves usage", async (isPredefined) => {
    const { account, apiKey } = await fixture();
    const [plan] = await db.insert(plans).values({
      name: "Replacement account plan", type: "account", isPredefined,
      accountId: isPredefined ? null : account.id,
      monthlyAllowance: 10, maxUnitsPerRequest: 5,
    }).returning();
    await db.insert(accountMonthlyUsage).values([
      { accountId: account.id, month: "2026-09-01", consumedUnits: 20 },
      { accountId: account.id, month: "2026-10-01", consumedUnits: 50 },
    ]);
    const usageBefore = await db.select().from(accountMonthlyUsage)
      .where(eq(accountMonthlyUsage.accountId, account.id));

    const res = await switchPlan(account.id, { planId: plan!.id }, apiKey);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: account.id, name: account.name, planId: plan!.id });
    expect(body).not.toHaveProperty("apiKeyHash");
    expect(body).not.toHaveProperty("apiKey");
    const [stored] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(stored).toMatchObject({ planId: plan!.id, apiKeyHash: hashApiKey(apiKey) });
    expect(await db.select().from(accountMonthlyUsage)
      .where(eq(accountMonthlyUsage.accountId, account.id))).toEqual(usageBefore);
  });

  for (const scenario of [
    { name: "a user plan", planId: () => userPlanId, status: 400,
      message: "Accounts must be assigned an account plan, not a user plan" },
    { name: "another account's custom plan", planId: () => customPlanId, status: 403,
      message: "You cannot assign a custom plan owned by another account" },
    { name: "a nonexistent plan", planId: () => randomUUID(), status: 404,
      message: "The requested plan was not found" },
  ]) {
    it(`rejects ${scenario.name} without changing the account`, async () => {
      const { account, apiKey } = await fixture();
      const res = await switchPlan(account.id, { planId: scenario.planId() }, apiKey);
      expect(res.status).toBe(scenario.status);
      expect(await res.json()).toEqual({ error: scenario.message });
      const [stored] = await db.select().from(accounts).where(eq(accounts.id, account.id));
      expect(stored).toEqual(account);
    });
  }

  it.each([undefined, {}, { planId: "invalid" }, { planId: 123 },
    { planId: randomUUID(), name: "Unexpected" }])("rejects invalid body %j", async (body) => {
    const { account, apiKey } = await fixture();
    const res = await switchPlan(account.id, body, apiKey);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    const [stored] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(stored).toEqual(account);
  });

  it.each([null, "wrong-key"])("rejects API key %s", async (key) => {
    const { account } = await fixture();
    const res = await switchPlan(account.id, { planId: accountPlanId }, key);
    expect(res.status).toBe(401);
    const [stored] = await db.select().from(accounts).where(eq(accounts.id, account.id));
    expect(stored).toEqual(account);
  });

  it.each([true, false])("returns 404 for an inaccessible account (exists: %s)", async (exists) => {
    const { apiKey } = await fixture();
    const other = exists ? (await fixture()).account : undefined;
    const res = await switchPlan(other?.id ?? randomUUID(), { planId: accountPlanId }, apiKey);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Account not found" });
    if (other) {
      const [stored] = await db.select().from(accounts).where(eq(accounts.id, other.id));
      expect(stored).toEqual(other);
    }
  });

  it("rejects an invalid account UUID", async () => {
    const { apiKey } = await fixture();
    const res = await switchPlan("invalid", { planId: accountPlanId }, apiKey);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Account ID must be a valid UUID" });
  });
});

describe("GET /api/accounts/:id/usage", () => {
  async function fixture() {
    const apiKey = `usage-${randomUUID()}`;
    const [account] = await db.insert(accounts).values({
      name: "Usage account", planId: accountPlanId, apiKeyHash: hashApiKey(apiKey),
    }).returning();
    return { account: account!, apiKey };
  }

  function currentMonth() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  function getUsage(id: string, apiKey: string | null) {
    return fetch(`${baseUrl}/api/accounts/${id}/usage`, {
      headers: apiKey === null ? {} : { "X-API-Key": apiKey },
    });
  }

  it("returns plan limits and zero usage without creating a monthly row", async () => {
    const { account, apiKey } = await fixture();
    const res = await getUsage(account.id, apiKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accountId: account.id, month: currentMonth(),
      plan: { id: accountPlanId, name: "Test account plan", monthlyAllowance: 1000, maxUnitsPerRequest: 100 },
      consumedUnits: 0, remainingUnits: 1000,
    });
    expect(await db.select().from(accountMonthlyUsage)
      .where(eq(accountMonthlyUsage.accountId, account.id))).toHaveLength(0);
  });

  it("returns only this account's current UTC month and leaves usage unchanged", async () => {
    const { account, apiKey } = await fixture();
    const other = await fixture();
    await db.insert(accountMonthlyUsage).values([
      { accountId: account.id, month: currentMonth(), consumedUnits: 250 },
      { accountId: account.id, month: "2000-01-01", consumedUnits: 900 },
      { accountId: other.account.id, month: currentMonth(), consumedUnits: 800 },
    ]);
    const before = await db.select().from(accountMonthlyUsage)
      .where(eq(accountMonthlyUsage.accountId, account.id));
    const res = await getUsage(account.id, apiKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ month: currentMonth(), consumedUnits: 250, remainingUnits: 750 });
    expect(await db.select().from(accountMonthlyUsage)
      .where(eq(accountMonthlyUsage.accountId, account.id))).toEqual(before);
  });

  it("treats historical usage alone as zero current usage", async () => {
    const { account, apiKey } = await fixture();
    await db.insert(accountMonthlyUsage).values({ accountId: account.id, month: "2000-01-01", consumedUnits: 900 });
    const res = await getUsage(account.id, apiKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ consumedUnits: 0, remainingUnits: 1000 });
  });

  it.each([1000, 1200])("clamps remaining allowance to zero at %i consumed units", async consumedUnits => {
    const { account, apiKey } = await fixture();
    await db.insert(accountMonthlyUsage).values({ accountId: account.id, month: currentMonth(), consumedUnits });
    const res = await getUsage(account.id, apiKey);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ consumedUnits, remainingUnits: 0 });
  });

  it("reflects plan switches and custom plan edits while preserving consumed units", async () => {
    const { account, apiKey } = await fixture();
    await db.insert(accountMonthlyUsage).values({ accountId: account.id, month: currentMonth(), consumedUnits: 250 });
    const [plan] = await db.insert(plans).values({ name: "Usage custom plan", type: "account",
      isPredefined: false, accountId: account.id, monthlyAllowance: 500, maxUnitsPerRequest: 50 }).returning();
    const switched = await fetch(`${baseUrl}/api/accounts/${account.id}/plan`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ planId: plan!.id }),
    });
    expect(switched.status).toBe(200);
    const first = await getUsage(account.id, apiKey);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ consumedUnits: 250, remainingUnits: 250,
      plan: { id: plan!.id, monthlyAllowance: 500, maxUnitsPerRequest: 50 } });
    const edited = await fetch(`${baseUrl}/api/plans/${plan!.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ name: "Reduced usage plan", monthlyAllowance: 100, maxUnitsPerRequest: 10 }),
    });
    expect(edited.status).toBe(200);
    const second = await getUsage(account.id, apiKey);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ consumedUnits: 250, remainingUnits: 0,
      plan: { id: plan!.id, name: "Reduced usage plan", monthlyAllowance: 100, maxUnitsPerRequest: 10 } });
  });

  it.each([null, "wrong-key"])("rejects API key %s", async key => {
    const { account } = await fixture();
    const res = await getUsage(account.id, key);
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });

  it.each([true, false])("hides inaccessible accounts (exists: %s)", async exists => {
    const { apiKey } = await fixture();
    const target = exists ? (await fixture()).account.id : randomUUID();
    const res = await getUsage(target, apiKey);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Account not found" });
  });

  it("rejects an invalid account UUID", async () => {
    const { apiKey } = await fixture();
    const res = await getUsage("invalid", apiKey);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Account ID must be a valid UUID" });
  });
});


describe("GET /api/accounts/:id/usage month query", () => {
  async function fixture() {
    const key = `history-${randomUUID()}`;
    const [record] = await db.insert(accounts).values({ name: "Historical usage", planId: accountPlanId,
      apiKeyHash: hashApiKey(key) }).returning();
    return { id: record!.id, key };
  }

  function getUsage(id: string, key: string, query: string) {
    return fetch(`${baseUrl}/api/accounts/${id}/usage?${query}`, {
      headers: { "X-API-Key": key },
    });
  }

  it("returns the selected past month's usage with current plan limits", async () => {
    const { id, key } = await fixture();
    await db.insert(accountMonthlyUsage).values([
      { accountId: id, month: "2000-01-01", consumedUnits: 250 },
      { accountId: id, month: "2000-02-01", consumedUnits: 1 },
    ]);
    const res = await getUsage(id, key, "month=2000-01");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accountId: id, month: "2000-01-01",
      consumedUnits: 250, remainingUnits: 750,
      plan: { id: accountPlanId, monthlyAllowance: 1000 } });
  });

  it("returns zero for a past month without a usage row", async () => {
    const { id, key } = await fixture();
    const res = await getUsage(id, key, "month=2000-03");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ month: "2000-03-01", consumedUnits: 0, remainingUnits: 1000 });
  });

  it("accepts an explicitly requested current UTC month", async () => {
    const { id, key } = await fixture();
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const res = await getUsage(id, key, `month=${month}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ month: `${month}-01` });
  });

  it("rejects the next UTC month", async () => {
    const { id, key } = await fixture();
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    const res = await getUsage(id, key, `month=${month}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Month cannot be after the current UTC month" });
  });

  it.each(["", "2000-00", "2000-13", "2000-1", "00-01", "2000-01-01", "September"])(
    "rejects invalid month %j", async month => {
      const { id, key } = await fixture();
      const res = await getUsage(id, key, `month=${encodeURIComponent(month)}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    },
  );

  it("rejects repeated month parameters", async () => {
    const { id, key } = await fixture();
    const res = await getUsage(id, key, "month=2000-01&month=2000-02");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it("still enforces ownership for historical queries", async () => {
    const { id } = await fixture();
    const res = await getUsage(id, "fixture-owner-key", "month=2000-01");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Account not found" });
  });
});
