import { db } from "../index.js";
import { users, NewUser, User, userMonthlyUsage } from "../schema.js";
import { and, eq } from "drizzle-orm";


export async function createUser (user: NewUser){
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser
}

export async function getUserById(id: string, accountId: string){
    // Filter by ownership in the query so another account's user is never returned.
    const [user] = await db.select().from(users)
        .where(and(eq(users.id, id), eq(users.accountId, accountId)))
    return user
}

export async function updateUserPlan(id: string, accountId: string, planId: string) {
    const [user] = await db.update(users).set({ planId })
        .where(and(eq(users.id, id), eq(users.accountId, accountId)))
        .returning();
    return user;
}


export async function getUserUsage(userId: string, month: string) {
  const [usage] = await db
    .select()
    .from(userMonthlyUsage)
    .where(and(
      eq(userMonthlyUsage.userId, userId),
      eq(userMonthlyUsage.month, month),
    ));

  return usage;
}
export async function getUsersByAccount(accountId: string) {
  return db.select().from(users).where(eq(users.accountId, accountId)).orderBy(users.id);
}
