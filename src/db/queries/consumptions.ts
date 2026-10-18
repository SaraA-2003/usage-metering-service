import { db } from "../index.js";
import { and, eq } from "drizzle-orm";
import { accountMonthlyUsage, accounts, consumptionRequests, plans, userMonthlyUsage, users } from "../schema.js";
import type { NewConsumptionRequest } from "../schema.js";
import { sql } from "drizzle-orm";


type Transaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/*
Finds the account and locks its row until the transaction finishes.
 If the account doesn’t exist, it returns undefined.
*/
export async function getAccountForUpdate(tx: Transaction, accountId: string) 
{
  const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId))
    .for("update");
  return account;
}

export async function getConsumptionUser(tx: Transaction, userId: string, accountId: string,
) {
  const [user] = await tx.select().from(users).where(and(
      eq(users.id, userId),
      eq(users.accountId, accountId),
    ));
  return user;
}

export async function getConsumptionRequest(tx: Transaction, accountId: string, requestId: string,
) {
  const [request] = await tx.select().from(consumptionRequests)
    .where(and(
      eq(consumptionRequests.accountId, accountId),
      eq(consumptionRequests.requestId, requestId),
    ));
  return request;
}

export async function getAccountMonthlyUsage(tx: Transaction, accountId: string, month: string,
) {
  const [usage] = await tx.select().from(accountMonthlyUsage)
    .where(and(
      eq(accountMonthlyUsage.accountId, accountId),
      eq(accountMonthlyUsage.month, month),
    ));
  return usage;
}

export async function getUserMonthlyUsage(tx: Transaction, userId: string, month: string,
) {
  const [usage] = await tx.select().from(userMonthlyUsage)
    .where(and(
      eq(userMonthlyUsage.userId, userId),
      eq(userMonthlyUsage.month, month),
    ));
  return usage;
}

export async function getConsumptionPlan(tx: Transaction, planId: string,
) {
  const [plan] = await tx.select().from(plans)
    .where(eq(plans.id, planId));
  return plan;
}

export async function saveConsumptionRequest(tx: Transaction, request: NewConsumptionRequest,
) {
  const [saved] = await tx.insert(consumptionRequests).values(request)
  .returning();
  return saved;
}


export async function incrementAccountUsage(tx: Transaction, accountId: string,
    month: string,
    units: number,
) 
{
  const [usage] = await tx.insert(accountMonthlyUsage)
    //No row for this month 
    .values({ accountId, month, consumedUnits: units })
    .onConflictDoUpdate({
      target: [
        accountMonthlyUsage.accountId,
        accountMonthlyUsage.month,
      ],
      //Row already exists
      set: {
        consumedUnits: sql`${accountMonthlyUsage.consumedUnits} + ${units}`,
      },
    })
    .returning();
  return usage;
}

export async function incrementUserUsage(tx: Transaction, userId: string,
    month: string,
    units: number,
) 
{
  const [usage] = await tx.insert(userMonthlyUsage)
    //No row for this month 
    .values({ userId, month, consumedUnits: units })
    .onConflictDoUpdate({
      target: [
        userMonthlyUsage.userId,
       userMonthlyUsage.month,
      ],
      //Row already exists
      set: {
        consumedUnits: sql`${userMonthlyUsage.consumedUnits} + ${units}`,
      },
    })
    .returning();
  return usage;
}