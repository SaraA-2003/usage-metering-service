import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { app } from "../src/app.js";
import { db } from "../src/db/index.js";
import { accounts, plans } from "../src/db/schema.js";
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
  // A second authenticated account lets plan tests verify ownership boundaries.
  await db.insert(accounts).values({
    name: "Plan naming account", planId: accountPlanId,
    apiKeyHash: hashApiKey("plan-name-key"),
  });
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
    await db.$client.end();
  }
});

describe("Plan endpoints", () => {
  function requestPlan(name: string, type = "account", key = "fixture-owner-key", extra = {}) {
    return fetch(`${baseUrl}/api/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify({ name, type, monthlyAllowance: 100, maxUnitsPerRequest: 10, ...extra }),
    });
  }

  it("rejects a predefined name with the same type ignoring case and surrounding spaces", async () => {
    const before = await db.select().from(plans);
    const res = await requestPlan("  TEST ACCOUNT PLAN  ");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A plan with this name and type already exists" });
    expect(await db.select().from(plans)).toHaveLength(before.length);
  });

  it("rejects an owned custom name with the same type", async () => {
    const res = await requestPlan("  CUSTOM ACCOUNT PLAN  ");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A plan with this name and type already exists" });
  });

  it("allows an existing name with a different type", async () => {
    const res = await requestPlan("Test account plan", "user");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Test account plan", type: "user", isPredefined: false });
  });

  it("allows another account to use the same custom name and type", async () => {
    const [other] = await db.select().from(accounts)
      .where(eq(accounts.apiKeyHash, hashApiKey("plan-name-key")));
    const res = await requestPlan("Custom account plan", "account", "plan-name-key");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ accountId: other!.id, type: "account", isPredefined: false });
  });

  it("creates an owned custom plan and rejects a later duplicate", async () => {
    const [owner] = await db.select().from(accounts).where(eq(accounts.apiKeyHash, hashApiKey("fixture-owner-key")));
    const first = await requestPlan(" New custom plan ");
    expect(first.status).toBe(201);
    const plan = await first.json();
    expect(plan).toMatchObject({ name: "New custom plan", accountId: owner!.id, isPredefined: false });
    const [stored] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(stored).toMatchObject({ accountId: owner!.id, isPredefined: false });
    const duplicate = await requestPlan("NEW CUSTOM PLAN");
    expect(duplicate.status).toBe(409);
    await duplicate.json();
  });

  it.each([null, "wrong-key"])("rejects unauthenticated listing and creation (%s)", async (key) => {
    const headers: Record<string, string> = key === null ? {} : { "X-API-Key": key };
    for (const method of ["GET", "POST"]) {
      const res = await fetch(`${baseUrl}/api/plans`, { method, headers });
      expect(res.status).toBe(401);
      expect(await res.json()).toHaveProperty("error");
    }
  });

  it.each([
    { monthlyAllowance: -1 }, { maxUnitsPerRequest: 0 },
    { monthlyAllowance: 1.5 }, { type: "invalid" },
    { isPredefined: true }, { accountId: randomUUID() },
  ])("rejects invalid or server-controlled fields %j", async (extra) => {
    const res = await requestPlan("Invalid plan", "account", "fixture-owner-key", extra);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("lists predefined and owned plans while hiding other accounts' plans", async () => {
    const allPlans = await db.select().from(plans);
    const [owner] = await db.select().from(accounts).where(eq(accounts.apiKeyHash, hashApiKey("fixture-owner-key")));
    const expected = allPlans.filter((plan) => plan.isPredefined || plan.accountId === owner!.id);
    expect(allPlans.some((plan) => !plan.isPredefined && plan.accountId !== owner!.id)).toBe(true);
    const res = await fetch(`${baseUrl}/api/plans`, { headers: { "X-API-Key": "fixture-owner-key" } });
    expect(res.status).toBe(200);
    const returned = await res.json();
    expect(returned.map((plan: { id: string }) => plan.id).sort()).toEqual(expected.map((plan) => plan.id).sort());
  });
});

describe("PUT /api/plans/:id", () => {
  function update(id: string, body: unknown, key = "fixture-owner-key") {
    return fetch(`${baseUrl}/api/plans/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify(body),
    });
  }

  it("updates limits and preserves fields not supplied", async () => {
    const res = await update(customPlanId, { monthlyAllowance: 0, maxUnitsPerRequest: 5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: customPlanId, monthlyAllowance: 0, maxUnitsPerRequest: 5, name: "Custom account plan", type: "account" });
    const [stored] = await db.select().from(plans).where(eq(plans.id, customPlanId));
    expect(stored).toMatchObject({ monthlyAllowance: 0, maxUnitsPerRequest: 5 });
  });

  it.each([{}, { monthlyAllowance: -1 }, { maxUnitsPerRequest: 0 }, { type: "user" }, { accountId: randomUUID() }])("rejects invalid updates %j", async (body) => {
    const res = await update(customPlanId, body);
    expect(res.status).toBe(400);
    await res.json();
  });

  it("rejects predefined plans", async () => {
    const res = await update(accountPlanId, { name: "Changed" });
    expect(res.status).toBe(403);
    await res.json();
  });

  it("rejects another account's plan", async () => {
    const res = await update(customPlanId, { name: "Changed" }, "plan-name-key");
    expect(res.status).toBe(403);
    await res.json();
  });

  it("rejects conflicting names but permits keeping the current name", async () => {
    const conflict = await update(customPlanId, { name: "TEST ACCOUNT PLAN" });
    expect(conflict.status).toBe(409);
    await conflict.json();
    const unchanged = await update(customPlanId, { name: "Custom account plan" });
    expect(unchanged.status).toBe(200);
    await unchanged.json();
  });

  it("returns 404 for a nonexistent plan", async () => {
    const res = await update(randomUUID(), { monthlyAllowance: 10 });
    expect(res.status).toBe(404);
    await res.json();
  });
});
