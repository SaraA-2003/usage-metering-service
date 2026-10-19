import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { app } from "../src/app.js";
import { db } from "../src/db/index.js";
import { hashApiKey } from "../src/auth.js";
import { accounts, plans, users, accountMonthlyUsage, userMonthlyUsage, consumptionRequests } from "../src/db/schema.js";

let server: Server | undefined;
let baseUrl: string;

// Like the existing suites, this clears application data in the configured DB_URL.
beforeAll(async () => {
  await db.execute(sql`TRUNCATE TABLE client_sessions, consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 15000);

afterAll(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => {
      server!.close(error => error ? reject(error) : resolve());
      server!.closeAllConnections();
    });
  } finally {
    try {
      await db.execute(sql`TRUNCATE TABLE client_sessions, consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
    } finally {
      await db.$client.end();
    }
  }
});

async function fixture(accountAllowance = 100, userAllowance = 50, accountMax = 40, userMax = 20) {
  const [accountPlan] = await db.insert(plans).values({ name: `Account ${randomUUID()}`, type: "account", isPredefined: true,
    monthlyAllowance: accountAllowance, maxUnitsPerRequest: accountMax }).returning();
  const [userPlan] = await db.insert(plans).values({ name: `User ${randomUUID()}`, type: "user", isPredefined: true,
    monthlyAllowance: userAllowance, maxUnitsPerRequest: userMax }).returning();
  const key = randomUUID();
  const [account] = await db.insert(accounts).values({ name: "App", planId: accountPlan!.id,
    apiKeyHash: hashApiKey(key) }).returning();
  const registered = await db.insert(users).values([
    { accountId: account!.id, planId: userPlan!.id },
    { accountId: account!.id, planId: userPlan!.id },
  ]).returning();
  return { key, account: account!, user: registered[0]!, otherUser: registered[1]!, userPlan: userPlan! };
}

function request(key: string | null, body: unknown) {
  return fetch(`${baseUrl}/api/consumptions`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
    body: JSON.stringify(body),
  });
}

async function consume(f: Awaited<ReturnType<typeof fixture>>, units: number, requestId = randomUUID(), userId = f.user.id) {
  const res = await request(f.key, { userId, units, requestId });
  expect(res.status).toBe(200);
  return res.json();
}

async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    account: await db.select().from(accountMonthlyUsage).where(eq(accountMonthlyUsage.accountId, f.account.id)),
    user: await db.select().from(userMonthlyUsage).where(eq(userMonthlyUsage.userId, f.user.id)),
    outcomes: await db.select().from(consumptionRequests).where(eq(consumptionRequests.accountId, f.account.id)),
  };
}

describe("POST /api/consumptions", () => {
  it("accepts usage, updates both totals, and keeps users' totals separate", async () => {
    const f = await fixture();
    const first = await consume(f, 10);
    expect(first).toMatchObject({ replayed: false, remaining: { account: 90, user: 40 },
      outcome: { decision: "accepted", blockingLevel: null, blockingRule: null } });
    await consume(f, 5, randomUUID(), f.otherUser.id);
    const saved = await state(f);
    expect(saved.account[0]!.consumedUnits).toBe(15);
    expect(saved.user[0]!.consumedUnits).toBe(10);
    expect(saved.outcomes).toHaveLength(2);
  });

  it.each([
    { level: "account", rule: "max_units_per_request", limits: [100, 100, 5, 5], units: 6 },
    { level: "account", rule: "monthly_allowance", limits: [5, 5, 20, 20], units: 6 },
    { level: "user", rule: "max_units_per_request", limits: [100, 100, 20, 5], units: 6 },
    { level: "user", rule: "monthly_allowance", limits: [100, 5, 20, 20], units: 6 },
  ])("records rejection by $level $rule without consuming", async ({ level, rule, limits, units }) => {
    const f = await fixture(...limits as [number, number, number, number]);
    const body = await consume(f, units);
    expect(body.outcome).toMatchObject({ decision: "rejected", blockingLevel: level, blockingRule: rule });
    const saved = await state(f);
    expect(saved.account).toHaveLength(0);
    expect(saved.user).toHaveLength(0);
    expect(saved.outcomes).toHaveLength(1);
    // A previous rejection must not leak into the next request.
    expect((await consume(f, 1)).outcome.decision).toBe("accepted");
  });

  it("enforces the shared quota across users and accepts the exact boundary", async () => {
    const f = await fixture(10, 100, 100, 100);
    await consume(f, 7);
    expect((await consume(f, 3, randomUUID(), f.otherUser.id)).remaining.account).toBe(0);
    expect((await consume(f, 1)).outcome).toMatchObject({ decision: "rejected", blockingLevel: "account" });
    expect((await state(f)).account[0]!.consumedUnits).toBe(10);
  });

  it("replays accepted and rejected requests without new writes", async () => {
    const f = await fixture();
    for (const units of [10, 30]) {
      const id = randomUUID();
      const first = await consume(f, units, id);
      const before = await state(f);
      expect(await consume(f, units, id)).toEqual({ replayed: true, outcome: first.outcome });
      expect(await state(f)).toEqual(before);
    }
  });

  it.each(["units", "user"])("returns 409 for a changed %s with the same request ID", async change => {
    const f = await fixture();
    const id = randomUUID();
    await consume(f, 10, id);
    const before = await state(f);
    const res = await request(f.key, { requestId: id, units: change === "units" ? 11 : 10,
      userId: change === "user" ? f.otherUser.id : f.user.id });
    expect(res.status).toBe(409);
    expect(await state(f)).toEqual(before);
  });

  it("scopes request IDs to the account", async () => {
    const a = await fixture();
    const b = await fixture();
    const id = randomUUID();
    expect((await consume(a, 1, id)).replayed).toBe(false);
    expect((await consume(b, 1, id)).replayed).toBe(false);
  });

  it("serializes concurrent users against the shared quota", async () => {
    const f = await fixture(10, 100, 100, 100);
    const results = await Promise.all([
      consume(f, 7), consume(f, 7, randomUUID(), f.otherUser.id),
    ]);
    expect(results.map(r => r.outcome.decision).sort()).toEqual(["accepted", "rejected"]);
    expect((await state(f)).account[0]!.consumedUnits).toBe(7);
  });

  it("counts simultaneous identical retries only once", async () => {
    const f = await fixture();
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => consume(f, 10, id)));
    expect(results.filter(r => !r.replayed)).toHaveLength(1);
    const saved = await state(f);
    expect(saved.account[0]!.consumedUnits).toBe(10);
    expect(saved.user[0]!.consumedUnits).toBe(10);
    expect(saved.outcomes).toHaveLength(1);
  });

  it("keeps past months intact and replays an old request across months", async () => {
    const f = await fixture();
    const month = "2000-01-01";
    const requestId = randomUUID();
    await db.insert(accountMonthlyUsage).values({ accountId: f.account.id, month, consumedUnits: 99 });
    await db.insert(userMonthlyUsage).values({ userId: f.user.id, month, consumedUnits: 49 });
    await db.insert(consumptionRequests).values({ accountId: f.account.id, userId: f.user.id,
      requestId, month, units: 1, decision: "accepted" });
    expect((await consume(f, 1, requestId)).outcome.month).toBe(month);
    const fresh = await consume(f, 10);
    expect(fresh.remaining).toEqual({ account: 90, user: 40 });
    const now = new Date();
    expect(fresh.outcome.month).toBe(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`);
    const saved = await state(f);
    expect(saved.account.find(r => r.month === month)!.consumedUnits).toBe(99);
    expect(saved.user.find(r => r.month === month)!.consumedUnits).toBe(49);
  });

  it("uses edited custom plans and preserves usage after switching plans", async () => {
    const f = await fixture();
    const [custom] = await db.insert(plans).values({ name: "Custom", type: "user", isPredefined: false,
      accountId: f.account.id, monthlyAllowance: 30, maxUnitsPerRequest: 20 }).returning();
    const switched = await fetch(`${baseUrl}/api/users/${f.user.id}/plan`, { method: "PATCH",
      headers: { "Content-Type": "application/json", "X-API-Key": f.key }, body: JSON.stringify({ planId: custom!.id }) });
    expect(switched.status).toBe(200);
    await consume(f, 10);
    const edited = await fetch(`${baseUrl}/api/plans/${custom!.id}`, { method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": f.key },
      body: JSON.stringify({ name: "Reduced", monthlyAllowance: 5, maxUnitsPerRequest: 20 }) });
    expect(edited.status).toBe(200);
    const rejected = await consume(f, 1);
    expect(rejected.outcome).toMatchObject({ decision: "rejected", blockingLevel: "user", blockingRule: "monthly_allowance" });
    expect(rejected.remaining.user).toBe(0);
    expect((await state(f)).user[0]!.consumedUnits).toBe(10);
  });

  it.each([null, "wrong-key"])("rejects API key %s", async key => {
    const f = await fixture();
    expect((await request(key, { userId: f.user.id, units: 1, requestId: randomUUID() })).status).toBe(401);
    expect((await state(f)).outcomes).toHaveLength(0);
  });

  it("hides users from other accounts and missing users", async () => {
    const f = await fixture();
    const other = await fixture();
    for (const userId of [other.user.id, randomUUID()]) {
      const res = await request(f.key, { userId, units: 1, requestId: randomUUID() });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "User not found" });
    }
    expect((await state(f)).outcomes).toHaveLength(0);
  });

  it.each([{}, { units: 0 }, { units: -1 }, { units: 1.5 }, { units: 2147483648 },
    { units: "1" }, { userId: "invalid" }, { requestId: " " }, { requestId: "a".repeat(256) },
    { accountId: randomUUID() }])("rejects invalid input %j", async override => {
    const f = await fixture();
    const body = Object.keys(override).length ? { userId: f.user.id, units: 1, requestId: randomUUID(), ...override } : {};
    expect((await request(f.key, body)).status).toBe(400);
    const saved = await state(f);
    expect(saved.outcomes).toHaveLength(0);
    expect(saved.account).toHaveLength(0);
  });

  it("uses the normalized request ID from validation", async () => {
    const f = await fixture();
    const id = randomUUID();
    await consume(f, 1, ` ${id} `);
    expect((await consume(f, 1, id)).replayed).toBe(true);
    expect((await state(f)).account[0]!.consumedUnits).toBe(1);
  });
});

describe("GET /api/consumptions/history", () => {
  function history(key: string | null, query = "") {
    return fetch(`${baseUrl}/api/consumptions/history${query ? `?${query}` : ""}`, {
      headers: key === null ? {} : { "X-API-Key": key },
    });
  }

  async function seed(f: Awaited<ReturnType<typeof fixture>>, count = 5) {
    // Equal timestamps deliberately exercise the request ID tie breaker.
    return db.insert(consumptionRequests).values(Array.from({ length: count }, (_, i) => ({
      accountId: f.account.id, userId: i % 2 ? f.otherUser.id : f.user.id,
      requestId: `history-${String(i).padStart(3, "0")}`, units: 1,
      month: "2000-01-01", createdAt: new Date("2000-01-02T00:00:00Z"),
      decision: i % 2 ? "rejected" as const : "accepted" as const,
      blockingLevel: i % 2 ? "user" as const : null,
      blockingRule: i % 2 ? "monthly_allowance" as const : null,
    }))).returning();
  }

  it("returns an empty first page with defaults", async () => {
    const f = await fixture();
    const res = await history(f.key);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [], limit: 20, offset: 0, hasMore: false, nextOffset: null });
  });

  it("defaults to 20 records and orders newest first with deterministic timestamp ties", async () => {
    const f = await fixture();
    await seed(f, 22);
    await db.insert(consumptionRequests).values({ accountId: f.account.id, userId: f.user.id,
      requestId: "newest", units: 1, month: "2000-02-01", decision: "accepted",
      createdAt: new Date("2000-02-02T00:00:00Z") });
    const res = await history(f.key);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(body.hasMore).toBe(true);
    expect(body.nextOffset).toBe(20);
    expect(body.requests.map((r: { requestId: string }) => r.requestId)).toEqual([
      "newest", ...Array.from({ length: 19 }, (_, i) => `history-${String(21 - i).padStart(3, "0")}`),
    ]);
  });

  it("paginates accepted and rejected outcomes without overlap or changes to stored data", async () => {
    const f = await fixture();
    await seed(f);
    const before = await state(f);
    const ids: string[] = [];
    for (const offset of [0, 2, 4]) {
      const res = await history(f.key, `limit=2&offset=${offset}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ limit: 2, offset,
        hasMore: offset < 4, nextOffset: offset < 4 ? offset + 2 : null });
      ids.push(...body.requests.map((r: { requestId: string }) => r.requestId));
      if (offset === 0) {
        expect(body.requests[0]).toMatchObject({ decision: "accepted", blockingLevel: null, blockingRule: null });
        expect(body.requests[1]).toMatchObject({ decision: "rejected", blockingLevel: "user", blockingRule: "monthly_allowance" });
      }
    }
    expect(ids).toEqual(["history-004", "history-003", "history-002", "history-001", "history-000"]);
    const beyond = await history(f.key, "limit=2&offset=10");
    expect(beyond.status).toBe(200);
    expect(await beyond.json()).toEqual({ requests: [], limit: 2, offset: 10, hasMore: false, nextOffset: null });
    expect(await state(f)).toEqual(before);
  });

  it("filters by user before applying pagination", async () => {
    const f = await fixture();
    await seed(f);
    const res = await history(f.key, `userId=${f.user.id}&limit=1&offset=1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({ userId: f.user.id, requestId: "history-002" });
    expect(body).toMatchObject({ hasMore: true, nextOffset: 2 });
    const last = await history(f.key, `userId=${f.user.id}&limit=1&offset=2`);
    expect(last.status).toBe(200);
    const lastBody = await last.json();
    expect(lastBody.requests).toHaveLength(1);
    expect(lastBody).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it("returns empty history for an owned user without outcomes", async () => {
    const f = await fixture();
    await consume(f, 1);
    const res = await history(f.key, `userId=${f.otherUser.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [], limit: 20, offset: 0, hasMore: false, nextOffset: null });
  });

  it("has no next page when exactly limit records remain", async () => {
    const f = await fixture();
    await seed(f, 4);
    const res = await history(f.key, "limit=2&offset=2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(2);
    expect(body).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it("excludes other accounts even when request IDs are identical", async () => {
    const f = await fixture();
    const other = await fixture();
    await seed(f);
    await seed(other);
    const res = await history(f.key, "limit=100");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toHaveLength(5);
    expect(body.requests.every((r: { accountId: string }) => r.accountId === f.account.id)).toBe(true);
  });

  it("hides foreign and nonexistent user filters", async () => {
    const f = await fixture();
    const other = await fixture();
    for (const userId of [other.user.id, randomUUID()]) {
      const res = await history(f.key, `userId=${userId}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "User not found" });
    }
  });

  it.each([null, "wrong-key"])("rejects API key %s", async key => {
    const res = await history(key);
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });

  it.each([
    "limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=abc", "limit=",
    "offset=-1", "offset=1.5", "offset=abc", "offset=", "offset=2147483648",
    "userId=invalid", "userId=", "limit=1&limit=2", "offset=0&offset=1",
    "userId=invalid&userId=invalid", "unknown=value",
  ])("rejects invalid query %s", async query => {
    const f = await fixture();
    const res = await history(f.key, query);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});


describe("JSON parsing errors", () => {
  it.each(["null", "{broken", "123"])("returns 400 for invalid JSON body %s", async body => {
    const res = await fetch(`${baseUrl}/api/consumptions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });
});
