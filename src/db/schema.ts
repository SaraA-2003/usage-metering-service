import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
// The explicit column type resolves type inference for plans <-> accounts references.
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const planType = pgEnum("plan_type", ["account", "user"]);

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name").notNull(),
  type: planType("type").notNull(),
  accountId: uuid("account_id").references((): AnyPgColumn => accounts.id, {onDelete:"restrict"}),
  isPredefined: boolean("is_predefined").notNull(),
  monthlyAllowance: integer("monthly_allowance").notNull(),
  maxUnitsPerRequest: integer("max_units_per_request").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("plans_predefined_name_type_unique")
    .on(table.type, sql`lower(trim(${table.name}))`).where(sql`${table.isPredefined} = true`),
  uniqueIndex("plans_custom_owner_name_type_unique")
    .on(table.accountId, table.type, sql`lower(trim(${table.name}))`).where(sql`${table.isPredefined} = false`),
  check("plans_monthly_allowance_nonnegative", sql`${table.monthlyAllowance} >= 0`),
  check("plans_max_units_per_request_positive", sql`${table.maxUnitsPerRequest} > 0`),
  // Predefined plans have no owner; custom plans must belong to an account.
  check(
    "plan_ownership_check",
    sql`(
      (${table.isPredefined} = true AND ${table.accountId} IS NULL)
      OR
      (${table.isPredefined} = false AND ${table.accountId} IS NOT NULL)
    )`,
  ),
]);

    export type NewPlan = typeof plans.$inferInsert
    export type Plan = typeof plans.$inferSelect
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  planId: uuid("plan_id").notNull().references(() => plans.id, {onDelete:"restrict"}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
apiKeyHash: varchar("api_key_hash", { length: 64 })
    .notNull()
    .unique(),
});

    export type NewAccount = typeof accounts.$inferInsert
    export type Account = typeof accounts.$inferSelect

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, {onDelete:"restrict"}),
  planId: uuid("plan_id").notNull().references(() => plans.id, {onDelete:"restrict"}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

    export type NewUser = typeof users.$inferInsert
    export type User = typeof users.$inferSelect

// One row per account and UTC month; use the month's first day (YYYY-MM-01).
// Keep past rows and preserve totals when the account changes plans.
export const accountMonthlyUsage = pgTable("account_monthly_usage", {
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  month: date("month").notNull(),
  consumedUnits: integer("consumed_units").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.month] }),
  check("account_monthly_usage_consumed_units_nonnegative", sql`${table.consumedUnits} >= 0`),
]);

export type NewAccountMonthlyUsage = typeof accountMonthlyUsage.$inferInsert;
export type AccountMonthlyUsage = typeof accountMonthlyUsage.$inferSelect;

// Users have separate totals even when they share the same plan.
export const userMonthlyUsage = pgTable("user_monthly_usage", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  month: date("month").notNull(),
  consumedUnits: integer("consumed_units").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.userId, table.month] }),
  check("user_monthly_usage_consumed_units_nonnegative", sql`${table.consumedUnits} >= 0`),
]);

export type NewUserMonthlyUsage = typeof userMonthlyUsage.$inferInsert;
export type UserMonthlyUsage = typeof userMonthlyUsage.$inferSelect;

export const consumptionDecision = pgEnum("consumption_decision", ["accepted", "rejected"]);
export const blockingLevel = pgEnum("blocking_level", ["account", "user"]);
export const blockingRule = pgEnum("blocking_rule", ["monthly_allowance", "max_units_per_request"]);

// Store both accepted and rejected outcomes for history and future retry handling.
// The consumption transaction still needs to keep these outcomes and totals in sync.
export const consumptionRequests = pgTable("consumption_requests", {
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "restrict" }),
  requestId: varchar("request_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  units: integer("units").notNull(),
  decision: consumptionDecision("decision").notNull(),
  blockingLevel: blockingLevel("blocking_level"),
  blockingRule: blockingRule("blocking_rule"),
  month: date("month").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // A request ID identifies one outcome within an account, across all months.
  primaryKey({ columns: [table.accountId, table.requestId] }),
  // The request ID breaks timestamp ties for stable history pagination.
  index("consumption_requests_account_history_idx")
    .on(table.accountId, table.createdAt, table.requestId),
  index("consumption_requests_user_history_idx")
    .on(table.accountId, table.userId, table.createdAt, table.requestId),
  check("consumption_requests_units_positive", sql`${table.units} > 0`),
  check("consumption_requests_request_id_nonempty", sql`length(trim(${table.requestId})) > 0`),
  check("consumption_requests_outcome_check", sql`(
    (${table.decision} = 'accepted' AND ${table.blockingLevel} IS NULL AND ${table.blockingRule} IS NULL)
    OR
    (${table.decision} = 'rejected' AND ${table.blockingLevel} IS NOT NULL AND ${table.blockingRule} IS NOT NULL)
  )`),
]);

export type NewConsumptionRequest = typeof consumptionRequests.$inferInsert;
export type ConsumptionRequest = typeof consumptionRequests.$inferSelect;

// Example client sessions store encrypted API keys, never plaintext keys.
export const clientSessions = pgTable("client_sessions", {
  idHash: varchar("id_hash", { length: 64 }).primaryKey(),
  browserHash: varchar("browser_hash", { length: 64 }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  encryptedKey: varchar("encrypted_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
