import { db } from "../index.js";
import { Plan, NewPlan, plans } from "../schema.js";
import { eq } from "drizzle-orm";


export async function createPlan (plan: NewPlan){
    const [newPlan] = await db.insert(plans).values(plan).returning();
    return newPlan
}

export async function getPlans (){
    const plansList = await db.select().from(plans)
    return plansList
}

export async function getPlanById(id : string){
    const [plan] = await db.select().from(plans).where(eq(plans.id, id))
    return plan
}

