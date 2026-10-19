import { db } from "../index.js";
import { Account, NewAccount, accountMonthlyUsage, accounts } from "../schema.js";
import { and, eq } from "drizzle-orm";


export async function createAccount(account: NewAccount){
    const [newAccount] = await db.insert(accounts).values(account).returning();
    return newAccount
}

export async function getAccountById (id: string){
    const account = await db.select().from(accounts).where(eq(accounts.id, id))
    return account
}

export async function getAccountByApiKeyHash(apiKeyHash: string) {
    const [account] = await db.select().from(accounts)
        .where(eq(accounts.apiKeyHash, apiKeyHash)).limit(1);
    return account;
}

export async function updateAccountPlan(id: string, planId: string) {
    const [updatedAccount] = await db.update(accounts)
        .set({ planId })
        .where(eq(accounts.id, id))
        .returning();
    return updatedAccount;
}

export async function getAccountUsage(accountId: string, month: string) {
  const [usage] = await db
    .select()
    .from(accountMonthlyUsage)
    .where(and(
      eq(accountMonthlyUsage.accountId, accountId),
      eq(accountMonthlyUsage.month, month),
    ));

  return usage;
}
