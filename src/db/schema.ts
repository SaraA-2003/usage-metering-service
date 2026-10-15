import { sql } from "drizzle-orm";
import { boolean, check, integer, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const planType = pgEnum("plan_type", ["account", "user"]);

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name").notNull(),
  type: planType("type").notNull(),
  accountId: uuid("account_id").references((): AnyPgColumn => accounts.id),
  isPredefined: boolean("is_predefined").notNull(),
  monthlyAllowance: integer("monthly_allowance").notNull(),
  maxUnitsPerRequest: integer("max_units_per_request").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
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
  planId: uuid("plan_id").notNull().references(() => plans.id),
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
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  planId: uuid("plan_id").notNull().references(() => plans.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

    export type NewUser = typeof users.$inferInsert
    export type User = typeof users.$inferSelect