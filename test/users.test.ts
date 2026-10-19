import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { app } from "../src/app.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { accounts, plans, users, userMonthlyUsage } from "../src/db/schema.js";
import { hashApiKey } from "../src/auth.js";

let server: Server | undefined;
let baseUrl: string;
let accountId: string;
let accountPlanId: string;
let userPlanId: string;
let customPlanId: string;
let otherAccountPlanId: string;

// This suite clears the application tables in the database selected by DB_URL.
// Run only against a database whose application data may be deleted.
beforeAll(async () => {
  await db.execute(sql`TRUNCATE TABLE client_sessions, consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
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
  const createdAccounts = await db.insert(accounts).values([
    { name: "Test account", planId: accountPlanId, apiKeyHash: hashApiKey("test-key-one") },
    { name: "Other account", planId: accountPlanId, apiKeyHash: hashApiKey("test-key-two") },
  ]).returning();
  accountId = createdAccounts[0]!.id;
  const customPlans = await db.insert(plans).values([
    { name: "Owned custom plan", type: "user", isPredefined: false,
      accountId, monthlyAllowance: 100, maxUnitsPerRequest: 10 },
    { name: "Other custom plan", type: "user", isPredefined: false,
      accountId: createdAccounts[1]!.id, monthlyAllowance: 100, maxUnitsPerRequest: 10 },
  ]).returning();
  customPlanId = customPlans[0]!.id;
  otherAccountPlanId = customPlans[1]!.id;
  // Port 0 asks the OS for an available port; requests use the real middleware.
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
      await db.execute(sql`TRUNCATE TABLE client_sessions, consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
    } finally {
      await db.$client.end();
    }
  }
});

function createUserRequest(body: unknown, apiKey: string | null = "test-key-one") {
  return fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey === null ? {} : { "X-API-Key": apiKey }),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/users", () => {
  it("creates and persists a user with a predefined user plan", async () => {
    const res = await createUserRequest({ planId: userPlanId });
    expect(res.status).toBe(201);
    const user = await res.json();
    expect(user).toMatchObject({ accountId, planId: userPlanId });
    const [stored] = await db.select().from(users).where(eq(users.id, user.id));
    expect(stored).toMatchObject({ id: user.id, accountId, planId: userPlanId });
  });

  it("accepts a custom user plan owned by the authenticated account", async () => {
    const res = await createUserRequest({ planId: customPlanId });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ accountId, planId: customPlanId });
  });

  it.each([
    undefined, {}, { planId: "invalid" }, { planId: 123 },
    { planId: randomUUID(), accountId: randomUUID() },
  ])("rejects invalid body %j without inserting a user", async (body) => {
    const before = await db.select().from(users);
    const res = await createUserRequest(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(await db.select().from(users)).toHaveLength(before.length);
  });

  it("rejects a missing plan with 404", async () => {
    const res = await createUserRequest({ planId: randomUUID() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "The requested plan was not found" });
  });

  it("rejects an account plan with 400", async () => {
    const res = await createUserRequest({ planId: accountPlanId });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Users must be assigned a user plan, not an account plan" });
  });

  it("rejects another account's custom user plan with 403", async () => {
    const before = await db.select().from(users);
    const res = await createUserRequest({ planId: otherAccountPlanId });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You cannot assign a custom plan owned by another account" });
    expect(await db.select().from(users)).toHaveLength(before.length);
  });

  it.each([null, "invalid-key"])("rejects a missing or invalid API key (%s)", async (key) => {
    const before = await db.select().from(users);
    const res = await createUserRequest({ planId: userPlanId }, key);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: key === null ? "Missing API key" : "Invalid API key" });
    expect(await db.select().from(users)).toHaveLength(before.length);
  });
});

describe("GET /api/users/:id", () => {
  it("returns a stored user", async () => {
    const [user] = await db.insert(users).values({ accountId, planId: userPlanId }).returning();
    const res = await fetch(`${baseUrl}/api/users/${user!.id}`, { headers: { "X-API-Key": "test-key-one" } });
    expect(res.status).toBe(200);
    // HTTP JSON serializes database Date objects as ISO strings.
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(user)));
  });

  it("returns 404 for a nonexistent user", async () => {
    const res = await fetch(`${baseUrl}/api/users/${randomUUID()}`, { headers: { "X-API-Key": "test-key-one" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("requires authentication when listing users", async () => {
    const res = await fetch(`${baseUrl}/api/users`);
    expect(res.status).toBe(401);
    await res.text();
  });
});

describe("User lookup authentication and isolation", () => {
  it.each([null, "wrong-key"])("returns 401 for key %s", async (key) => {
    const res = await fetch(`${baseUrl}/api/users/${randomUUID()}`, {
      headers: key === null ? {} : { "X-API-Key": key },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });

  it("returns 404 when another account requests an existing user", async () => {
    const [user] = await db.insert(users).values({ accountId, planId: userPlanId }).returning();
    const res = await fetch(`${baseUrl}/api/users/${user!.id}`, {
      headers: { "X-API-Key": "test-key-two" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("returns 400 for an invalid user UUID", async () => {
    const res = await fetch(`${baseUrl}/api/users/invalid`, {
      headers: { "X-API-Key": "test-key-one" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "User ID must be a valid UUID" });
  });
});

describe("PATCH /api/users/:id/plan", () => {
  async function fixture() {
    const [user] = await db.insert(users).values({ accountId, planId: userPlanId }).returning();
    return user!;
  }

  function switchPlan(id: string, body: unknown, apiKey: string | null = "test-key-one") {
    return fetch(`${baseUrl}/api/users/${id}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(apiKey === null ? {} : { "X-API-Key": apiKey }) },
      body: JSON.stringify(body),
    });
  }

  it("switches to an owned custom plan and back to a predefined plan, preserving usage", async () => {
    const user = await fixture();
    await db.insert(userMonthlyUsage).values([
      { userId: user.id, month: "2026-09-01", consumedUnits: 20 },
      { userId: user.id, month: "2026-10-01", consumedUnits: 150 },
    ]);
    const usageBefore = await db.select().from(userMonthlyUsage)
      .where(eq(userMonthlyUsage.userId, user.id));
    for (const planId of [customPlanId, userPlanId]) {
      const res = await switchPlan(user.id, { planId });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: user.id, accountId, planId });
      const [stored] = await db.select().from(users).where(eq(users.id, user.id));
      expect(stored).toMatchObject({ id: user.id, accountId, planId });
      expect(await db.select().from(userMonthlyUsage)
        .where(eq(userMonthlyUsage.userId, user.id))).toEqual(usageBefore);
    }
  });

  for (const scenario of [
    { name: "an account plan", planId: () => accountPlanId, status: 400,
      error: "Users must be assigned a user plan, not an account plan" },
    { name: "another account's custom plan", planId: () => otherAccountPlanId, status: 403,
      error: "You cannot assign a custom plan owned by another account" },
    { name: "a nonexistent plan", planId: () => randomUUID(), status: 404,
      error: "The requested plan was not found" },
  ]) {
    it(`rejects ${scenario.name} without updating the user`, async () => {
      const user = await fixture();
      const res = await switchPlan(user.id, { planId: scenario.planId() });
      expect(res.status).toBe(scenario.status);
      expect(await res.json()).toEqual({ error: scenario.error });
      const [stored] = await db.select().from(users).where(eq(users.id, user.id));
      expect(stored).toEqual(user);
    });
  }

  it.each([undefined, {}, { planId: "invalid" }, { planId: 123 },
    { planId: randomUUID(), accountId: randomUUID() }])("rejects invalid body %j", async (body) => {
    const user = await fixture();
    const res = await switchPlan(user.id, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    const [stored] = await db.select().from(users).where(eq(users.id, user.id));
    expect(stored).toEqual(user);
  });

  it.each([null, "wrong-key"])("rejects API key %s without updating the user", async (key) => {
    const user = await fixture();
    const res = await switchPlan(user.id, { planId: customPlanId }, key);
    expect(res.status).toBe(401);
    const [stored] = await db.select().from(users).where(eq(users.id, user.id));
    expect(stored).toEqual(user);
  });

  it("hides another account's user and does not update it", async () => {
    const user = await fixture();
    const res = await switchPlan(user.id, { planId: otherAccountPlanId }, "test-key-two");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
    const [stored] = await db.select().from(users).where(eq(users.id, user.id));
    expect(stored).toEqual(user);
  });

  it("returns 404 for a nonexistent user", async () => {
    const res = await switchPlan(randomUUID(), { planId: userPlanId });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("rejects an invalid user UUID", async () => {
    const res = await switchPlan("invalid", { planId: userPlanId });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "User ID must be a valid UUID" });
  });
});

describe("GET /api/users/:id/usage", () => {
  async function fixture() {
    const [user] = await db.insert(users).values({ accountId, planId: userPlanId }).returning();
    return user!;
  }

  function currentMonth() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  function getUsage(id: string, key: string | null = "test-key-one") {
    return fetch(`${baseUrl}/api/users/${id}/usage`, {
      headers: key === null ? {} : { "X-API-Key": key },
    });
  }

  it("returns plan limits and zero usage without creating a monthly row", async () => {
    const user = await fixture();
    const res = await getUsage(user.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: user.id, accountId, month: currentMonth(),
      plan: { id: userPlanId, name: "Test user plan", monthlyAllowance: 100, maxUnitsPerRequest: 10 },
      consumedUnits: 0, remainingUnits: 100,
    });
    expect(await db.select().from(userMonthlyUsage)
      .where(eq(userMonthlyUsage.userId, user.id))).toHaveLength(0);
  });

  it("reads only this user's current UTC month and leaves usage unchanged", async () => {
    const user = await fixture();
    const other = await fixture();
    await db.insert(userMonthlyUsage).values([
      { userId: user.id, month: currentMonth(), consumedUnits: 25 },
      { userId: user.id, month: "2000-01-01", consumedUnits: 90 },
      { userId: other.id, month: currentMonth(), consumedUnits: 80 },
    ]);
    const before = await db.select().from(userMonthlyUsage).where(eq(userMonthlyUsage.userId, user.id));
    const res = await getUsage(user.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: user.id, month: currentMonth(), consumedUnits: 25, remainingUnits: 75 });
    expect(await db.select().from(userMonthlyUsage).where(eq(userMonthlyUsage.userId, user.id))).toEqual(before);
  });

  it("ignores historical usage when there is no current monthly row", async () => {
    const user = await fixture();
    await db.insert(userMonthlyUsage).values({ userId: user.id, month: "2000-01-01", consumedUnits: 90 });
    const res = await getUsage(user.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ consumedUnits: 0, remainingUnits: 100 });
  });

  it.each([100, 150])("returns zero remaining at %i consumed units", async consumedUnits => {
    const user = await fixture();
    await db.insert(userMonthlyUsage).values({ userId: user.id, month: currentMonth(), consumedUnits });
    const res = await getUsage(user.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ consumedUnits, remainingUnits: 0 });
  });

  it("reflects plan switches and custom edits while preserving consumed usage", async () => {
    const user = await fixture();
    await db.insert(userMonthlyUsage).values({ userId: user.id, month: currentMonth(), consumedUnits: 25 });
    const [plan] = await db.insert(plans).values({ name: "Usage custom user plan", type: "user",
      isPredefined: false, accountId, monthlyAllowance: 50, maxUnitsPerRequest: 5 }).returning();
    const headers = { "Content-Type": "application/json", "X-API-Key": "test-key-one" };
    const switched = await fetch(`${baseUrl}/api/users/${user.id}/plan`, {
      method: "PATCH", headers, body: JSON.stringify({ planId: plan!.id }),
    });
    expect(switched.status).toBe(200);
    const first = await getUsage(user.id);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ consumedUnits: 25, remainingUnits: 25,
      plan: { id: plan!.id, monthlyAllowance: 50, maxUnitsPerRequest: 5 } });
    const edited = await fetch(`${baseUrl}/api/plans/${plan!.id}`, {
      method: "PUT", headers,
      body: JSON.stringify({ name: "Reduced user plan", monthlyAllowance: 10, maxUnitsPerRequest: 2 }),
    });
    expect(edited.status).toBe(200);
    const second = await getUsage(user.id);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ consumedUnits: 25, remainingUnits: 0,
      plan: { id: plan!.id, name: "Reduced user plan", monthlyAllowance: 10, maxUnitsPerRequest: 2 } });
  });

  it.each([null, "wrong-key"])("rejects API key %s", async key => {
    const user = await fixture();
    const res = await getUsage(user.id, key);
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });

  it("hides an existing user's usage from another account", async () => {
    const user = await fixture();
    await db.insert(userMonthlyUsage).values({ userId: user.id, month: currentMonth(), consumedUnits: 25 });
    const res = await getUsage(user.id, "test-key-two");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("returns 404 for a nonexistent user", async () => {
    const res = await getUsage(randomUUID());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("rejects an invalid user UUID", async () => {
    const res = await getUsage("invalid");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "User ID must be a valid UUID" });
  });
});


describe("GET /api/users/:id/usage month query", () => {
  async function fixture() {
    const key = "test-key-one";
    const [record] = await db.insert(users).values({ accountId, planId: userPlanId }).returning();
    return { id: record!.id, key };
  }

  function getUsage(id: string, key: string, query: string) {
    return fetch(`${baseUrl}/api/users/${id}/usage?${query}`, {
      headers: { "X-API-Key": key },
    });
  }

  it("returns the selected past month's usage with current plan limits", async () => {
    const { id, key } = await fixture();
    await db.insert(userMonthlyUsage).values([
      { userId: id, month: "2000-01-01", consumedUnits: 25 },
      { userId: id, month: "2000-02-01", consumedUnits: 1 },
    ]);
    const res = await getUsage(id, key, "month=2000-01");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: id, month: "2000-01-01",
      consumedUnits: 25, remainingUnits: 75,
      plan: { id: userPlanId, monthlyAllowance: 100 } });
  });

  it("returns zero for a past month without a usage row", async () => {
    const { id, key } = await fixture();
    const res = await getUsage(id, key, "month=2000-03");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ month: "2000-03-01", consumedUnits: 0, remainingUnits: 100 });
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

  it.each(["", "0000-01", "2000-00", "2000-13", "2000-1", "00-01", "2000-01-01", "September"])(
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
    const res = await getUsage(id, "test-key-two", "month=2000-01");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });
});


describe("GET /api/users", () => {
  it("lists only users belonging to the authenticated account", async () => {
    await db.insert(users).values({ accountId, planId: userPlanId });
    const [other] = await db.select().from(accounts).where(eq(accounts.apiKeyHash, hashApiKey("test-key-two")));
    const [foreign] = await db.insert(users).values({ accountId: other!.id, planId: userPlanId }).returning();
    const res = await fetch(`${baseUrl}/api/users`, { headers: { "X-API-Key": "test-key-one" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((user: { accountId: string }) => user.accountId === accountId)).toBe(true);
    expect(body.some((user: { id: string }) => user.id === foreign!.id)).toBe(false);
  });
});
