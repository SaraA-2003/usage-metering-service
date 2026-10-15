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
  await db.execute(sql`TRUNCATE TABLE users, accounts, plans`);
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
