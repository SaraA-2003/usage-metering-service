import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { accounts, plans } from "../src/db/schema.js";
import { seedPredefinedPlans } from "../src/db/seed.js";
import { hashApiKey } from "../src/auth.js";

// Uses the same disposable DB_URL as the other integration suites.
async function clearTables() {
  await db.execute(sql`TRUNCATE TABLE consumption_requests, user_monthly_usage, account_monthly_usage, users, accounts, plans`);
}

beforeEach(clearTables);
afterEach(clearTables);
afterAll(async () => {
  try {
    await clearTables();
  } finally {
    await db.$client.end();
  }
});

function readPlans() {
  return db.select().from(plans).orderBy(plans.name);
}

describe("seedPredefinedPlans", () => {
  it("creates all four predefined plans with the agreed limits", async () => {
    await seedPredefinedPlans();
    const rows = await readPlans();
    expect(rows.map(({ name, type, monthlyAllowance, maxUnitsPerRequest, isPredefined, accountId }) => ({
      name, type, monthlyAllowance, maxUnitsPerRequest, isPredefined, accountId,
    }))).toEqual([
      { name: "Basic", type: "user", monthlyAllowance: 100, maxUnitsPerRequest: 10, isPredefined: true, accountId: null },
      { name: "Premium", type: "user", monthlyAllowance: 1000, maxUnitsPerRequest: 100, isPredefined: true, accountId: null },
      { name: "Pro", type: "account", monthlyAllowance: 10000, maxUnitsPerRequest: 1000, isPredefined: true, accountId: null },
      { name: "Starter", type: "account", monthlyAllowance: 1000, maxUnitsPerRequest: 100, isPredefined: true, accountId: null },
    ]);
  });

  it("leaves all existing records unchanged when run twice", async () => {
    await seedPredefinedPlans();
    const before = await readPlans();
    await seedPredefinedPlans();
    expect(await readPlans()).toEqual(before);
  });

  it("restores only the missing predefined plan", async () => {
    await seedPredefinedPlans();
    await db.delete(plans).where(eq(plans.name, "Premium"));
    const before = await readPlans();
    await seedPredefinedPlans();
    const after = await readPlans();
    expect(after).toHaveLength(4);
    expect(after.filter(p => p.name !== "Premium")).toEqual(before);
    expect(after.find(p => p.name === "Premium")).toMatchObject({
      type: "user", isPredefined: true,
      monthlyAllowance: 1000, maxUnitsPerRequest: 100, accountId: null
    });
  });

  it("preserves existing limits and matches predefined names without case or surrounding spaces", async () => {
    const [existing] = await db.insert(plans).values({
      name: " starter ", type: "account", isPredefined: true,
      monthlyAllowance: 77, maxUnitsPerRequest: 7
    }).returning();
    await seedPredefinedPlans();
    const rows = await readPlans();
    expect(rows).toHaveLength(4);
    expect(rows.find(p => p.id === existing!.id)).toEqual(existing);
  });

  it("leaves custom plans unchanged and does not treat them as predefined definitions", async () => {
    const [bootstrap] = await db.insert(plans).values({
      name: "Bootstrap", type: "account", isPredefined: true,
      monthlyAllowance: 100, maxUnitsPerRequest: 10
    }).returning();
    const [account] = await db.insert(accounts).values({
      name: "Seed owner", planId: bootstrap!.id,
      apiKeyHash: hashApiKey("seed-owner-key")
    }).returning();
    const [custom] = await db.insert(plans).values({
      name: "Premium", type: "user", isPredefined: false,
      accountId: account!.id, monthlyAllowance: 12, maxUnitsPerRequest: 2
    }).returning();
    await seedPredefinedPlans();
    const rows = await readPlans();
    expect(rows).toHaveLength(6);
    expect(rows.find(p => p.id === custom!.id)).toEqual(custom);
    expect(rows.find(p => p.id === bootstrap!.id)).toEqual(bootstrap);
    expect(rows.filter(p => p.name === "Premium" && p.isPredefined)).toHaveLength(1);
  });

  it("prevents duplicates when seed calls run simultaneously", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => seedPredefinedPlans()),
    );

    const rows = await readPlans();

    expect(rows).toHaveLength(4);
    expect(rows.map(plan => plan.name).sort()).toEqual([
      "Basic",
      "Premium",
      "Pro",
      "Starter",
    ]);
  });
});
