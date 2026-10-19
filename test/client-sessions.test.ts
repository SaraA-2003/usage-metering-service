import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { accounts, plans, clientSessions } from "../src/db/schema.js";
import { createSessionStore } from "../examples/web/sessions.js";

async function clear() {
  await db.execute(sql`TRUNCATE TABLE client_sessions, consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
}
beforeEach(clear);
afterEach(clear);
afterAll(async () => { try { await clear(); } finally { await db.$client.end(); } });

it("persists encrypted sessions across store recreation and rejects expired sessions", async () => {
  const [plan] = await db.insert(plans).values({ name: "Session plan", type: "account", isPredefined: true,
    monthlyAllowance: 100, maxUnitsPerRequest: 10 }).returning();
  const [account] = await db.insert(accounts).values({ name: "Session owner", planId: plan!.id, apiKeyHash: "a".repeat(64) }).returning();
  const secret = randomBytes(32).toString("hex");
  const id = randomUUID();
  const session = { accountId: account!.id, apiKey: "original-secret-api-key" };
  await createSessionStore(secret).set(id, session);
  const [stored] = await db.select().from(clientSessions);
  expect(stored!.encryptedKey).not.toContain(session.apiKey);
  expect(stored!.idHash).not.toBe(id);
  expect(await createSessionStore(secret).get(id)).toEqual(session);
  expect(await createSessionStore(secret).get(randomUUID())).toBeUndefined();
  await expect(createSessionStore(randomBytes(32).toString("hex")).get(id)).rejects.toThrow();
  await db.update(clientSessions).set({ expiresAt: new Date(0) }).where(eq(clientSessions.idHash, stored!.idHash));
  expect(await createSessionStore(secret).get(id)).toBeUndefined();
});

it("requires a valid encryption secret", () => {
  expect(() => createSessionStore("")).toThrow("SESSION_ENCRYPTION_KEY");
});

it("deletes only the selected session and preserves its account", async () => {
  const [plan] = await db.insert(plans).values({ name: "Disconnect plan", type: "account", isPredefined: true,
    monthlyAllowance: 100, maxUnitsPerRequest: 10 }).returning();
  const [account] = await db.insert(accounts).values({ name: "Keep account", planId: plan!.id, apiKeyHash: "b".repeat(64) }).returning();
  const store = createSessionStore(randomBytes(32).toString("hex"));
  const first = randomUUID();
  const second = randomUUID();
  const session = { accountId: account!.id, apiKey: "keep-key" };
  await store.set(first, session);
  await store.set(second, session);
  await store.delete(first);
  await store.delete(first); // Disconnecting twice is harmless.
  expect(await store.get(first)).toBeUndefined();
  expect(await store.get(second)).toEqual(session);
  expect(await db.select().from(accounts).where(eq(accounts.id, account!.id))).toHaveLength(1);
});

it("lists saved accounts only for the owning browser and can reconnect after store recreation", async () => {
  const [plan] = await db.insert(plans).values({ name: "Saved plan", type: "account", isPredefined: true,
    monthlyAllowance: 100, maxUnitsPerRequest: 10 }).returning();
  const owners = await db.insert(accounts).values([
    { name: "Browser A", planId: plan!.id, apiKeyHash: "c".repeat(64) },
    { name: "Browser B", planId: plan!.id, apiKeyHash: "d".repeat(64) },
  ]).returning();
  const secret = randomBytes(32).toString("hex");
  const store = createSessionStore(secret);
  await store.set(randomUUID(), { accountId: owners[0]!.id, apiKey: "key-a" }, "browser-a");
  await store.set(randomUUID(), { accountId: owners[1]!.id, apiKey: "key-b" }, "browser-b");
  const restored = createSessionStore(secret);
  expect(await restored.list("browser-a")).toEqual([{ accountId: owners[0]!.id, name: "Browser A" }]);
  expect(await restored.find("browser-a", owners[1]!.id)).toBeUndefined();
  const saved = await restored.find("browser-a", owners[0]!.id);
  expect(await restored.get(saved!.idHash, true)).toEqual({ accountId: owners[0]!.id, apiKey: "key-a" });
  expect(await restored.list("unknown-browser")).toEqual([]);
});
