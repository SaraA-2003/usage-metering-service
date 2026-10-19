import { db } from "./index.js";
import { plans } from "./schema.js";
import { eq, sql } from "drizzle-orm";
const predefinedPlans = [
    {
    name: "Starter",
    type: "account",
    monthlyAllowance: 1_000,
    maxUnitsPerRequest: 100,
  },
  {
    name: "Pro",
    type: "account",
    monthlyAllowance: 10_000,
    maxUnitsPerRequest: 1_000,
  },
  {
    name: "Basic",
    type: "user",
    monthlyAllowance: 100,
    maxUnitsPerRequest: 10,
  },
  {
    name: "Premium",
    type: "user",
    monthlyAllowance: 1_000,
    maxUnitsPerRequest: 100,
  },
] as const;


export async function seedPredefinedPlans() {
    await db.transaction(async (tx) => {
        // Allow only one predefined-plan seed transaction at a time.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(73124, 1)`);
        const existingPlans = await tx
        .select()
        .from(plans)
        .where(eq(plans.isPredefined, true));

        // Next: insert definitions that are missing.
        const missingPlans = predefinedPlans.filter((definition) =>
            !existingPlans.some((existing) =>
                existing.type === definition.type &&
                existing.name.trim().toLowerCase() === definition.name.toLowerCase()
            )
        );
        if (missingPlans.length > 0) {

            await tx.insert(plans).values(
                missingPlans.map((plan) => ({
                ...plan,
                isPredefined: true,
                accountId: null,
                })),
            );
        }
    });

}