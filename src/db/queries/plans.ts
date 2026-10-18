import { db } from "../index.js";
import { Plan, NewPlan, plans } from "../schema.js";
import { and, eq, or, sql } from "drizzle-orm";


export type PlanUpdates = Partial<Pick<NewPlan, "name" | "monthlyAllowance" | "maxUnitsPerRequest">>;

export async function updatePlan(id: string, accountId: string, updates: PlanUpdates) {
    const [updatedPlan] = await db.update(plans).set(updates).where(and(
        eq(plans.id, id), eq(plans.accountId, accountId), eq(plans.isPredefined, false),
    )).returning();
    return updatedPlan;
}

export async function createPlan(plan: NewPlan) {
    const [newPlan] = await db.insert(plans).values(plan).returning();
    return newPlan;
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
        .where(sql`lower(${plans.name}) = lower(${name})`);
}

