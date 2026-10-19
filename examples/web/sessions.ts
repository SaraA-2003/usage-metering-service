import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { clientSessions, accounts } from "../../src/db/schema.js";

type AccountSession = { accountId: string; apiKey: string };
export const sessionLifetime = 7 * 24 * 60 * 60 * 1000;

export function createSessionStore(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret)) {
    throw new Error("SESSION_ENCRYPTION_KEY must contain 64 hexadecimal characters (32 random bytes)");
  }
  const key = Buffer.from(secret, "hex");
  const hash = (id: string) => createHash("sha256").update(id).digest("hex");
  return {
    async list(browserId: string) {
      return db.select({ accountId: accounts.id, name: accounts.name }).from(clientSessions)
        .innerJoin(accounts, eq(accounts.id, clientSessions.accountId))
        .where(and(eq(clientSessions.browserHash, hash(browserId)), gt(clientSessions.expiresAt, new Date())))
        .groupBy(accounts.id, accounts.name).orderBy(accounts.name);
    },
    async find(browserId: string, accountId: string) {
      const [row] = await db.select({ idHash: clientSessions.idHash }).from(clientSessions).where(and(
        eq(clientSessions.browserHash, hash(browserId)), eq(clientSessions.accountId, accountId),
        gt(clientSessions.expiresAt, new Date()),
      ));
      return row;
    },
    async adopt(id: string, browserId: string) {
      await db.update(clientSessions).set({ browserHash: hash(browserId) }).where(and(
        eq(clientSessions.idHash, hash(id)), sql`${clientSessions.browserHash} IS NULL`,
      ));
    },
    async delete(id: string) {
      await db.delete(clientSessions).where(eq(clientSessions.idHash, hash(id)));
    },
    async set(id: string, session: AccountSession, browserId?: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(session.accountId));
      const encrypted = Buffer.concat([cipher.update(session.apiKey, "utf8"), cipher.final()]);
      await db.delete(clientSessions).where(lte(clientSessions.expiresAt, new Date()));
      await db.insert(clientSessions).values({
        idHash: hash(id), browserHash: browserId ? hash(browserId) : null, accountId: session.accountId,
        encryptedKey: [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("hex")).join(":"),
        expiresAt: new Date(Date.now() + sessionLifetime),
      });
    },
    async get(id: string, hashed = false): Promise<AccountSession | undefined> {
      const [row] = await db.select().from(clientSessions).where(and(
        eq(clientSessions.idHash, hashed ? id : hash(id)), gt(clientSessions.expiresAt, new Date()),
      ));
      if (!row) return undefined;
      const [iv, tag, encrypted] = row.encryptedKey.split(":").map(value => Buffer.from(value, "hex"));
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(row.accountId));
      decipher.setAuthTag(tag);
      const apiKey = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      return { accountId: row.accountId, apiKey };
    },
  };
}
