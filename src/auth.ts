import { createHash, randomBytes } from "node:crypto";

// Generate the secret randomly; hashing is only for storing and looking it up.

export function generateApiKey(): string {
  return `ums_${randomBytes(32).toString("hex")}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}
