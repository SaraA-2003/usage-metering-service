import { db } from "../index.js";
import { users, NewUser, User } from "../schema.js";
import { eq } from "drizzle-orm";


export async function createUser (user: NewUser){
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser
}

export async function getUserById(id : string){
    const user = await db.select().from(users).where(eq(users.id, id))
    return user
}