import { createHash, randomBytes } from "node:crypto";

//--------------------- ApiKey ------------------------

export function generateApiKey(): string {
  return `ums_${randomBytes(32).toString("hex")}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}
