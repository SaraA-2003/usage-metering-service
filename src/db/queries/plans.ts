import { db } from "../index.js";
import { Plan, NewPlan, plans } from "../schema.js";
import { and, eq, or, sql } from "drizzle-orm";


export type PlanUpdates = Partial<Pick<NewPlan, "name" | "monthlyAllowance" | "maxUnitsPerRequest">>;

export class PlanNameConflict extends Error {}

// Serialize name checks and writes for each owner, including concurrent renames.
export async function updatePlan(id: string, accountId: string, updates: PlanUpdates) {
    return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${accountId}, 0))`);
        const [current] = await tx.select().from(plans).where(and(
            eq(plans.id, id), eq(plans.accountId, accountId), eq(plans.isPredefined, false),
        ));
        if (!current) return undefined;
        if (updates.name !== undefined) {
            const duplicates = await tx.select().from(plans).where(and(
                sql`lower(trim(${plans.name})) = lower(trim(${updates.name}))`,
                eq(plans.type, current.type),
                or(eq(plans.accountId, accountId), eq(plans.isPredefined, true)),
                sql`${plans.id} <> ${id}`,
            ));
            if (duplicates.length) throw new PlanNameConflict();
        }
        const [updatedPlan] = await tx.update(plans).set(updates).where(eq(plans.id, id)).returning();
        return updatedPlan;
    });
}

export async function createPlan(plan: NewPlan) {
    return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${plan.accountId ?? "predefined"}, 0))`);
        const duplicates = await tx.select().from(plans).where(and(
            sql`lower(trim(${plans.name})) = lower(trim(${plan.name}))`,
            eq(plans.type, plan.type),
            or(eq(plans.isPredefined, true), plan.accountId ? eq(plans.accountId, plan.accountId) : undefined),
        ));
        if (duplicates.length) throw new PlanNameConflict();
        const [newPlan] = await tx.insert(plans).values(plan).returning();
        return newPlan;
    });
}

export async function getPlans (accountId: string){
    const plansList = await db.select().from(plans).where(or(eq(plans.accountId, accountId), eq(plans.isPredefined, true)))
    return plansList
}

export async function getPlanById(id : string){
    const [plan] = await db.select().from(plans).where(eq(plans.id, id))
    return plan
}

export async function getPlansByName(name: string) {
    return db.select().from(plans)
        .where(sql`lower(trim(${plans.name})) = lower(trim(${name}))`);
}

export async function getPredefinedPlans() {
  return db
    .select()
    .from(plans)
    .where(eq(plans.isPredefined, true));
}