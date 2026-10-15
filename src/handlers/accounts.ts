import type { Request, Response, NextFunction } from "express";
import { createAccount, getAccountById } from "../db/queries/accounts.js";
import { BadRequestError, NotFoundError } from "../customErrors.js";
import { z } from "zod";
import { generateApiKey, hashApiKey } from "../auth.js";
import { getPlanById } from "../db/queries/plans.js";

const createAccountSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  planId: z.uuid(), 
});

export async function handlerCreateAccount(req: Request, res: Response, next: NextFunction) {
  const result = createAccountSchema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));
  }

  const plan = await getPlanById(result.data.planId);
  if (!plan) {
    throw new NotFoundError("The requested plan was not found");
  }
  if (plan.type !== "account") {
    throw new BadRequestError("Accounts must be assigned an account plan, not a user plan");
  }
  if (!plan.isPredefined) {
    throw new BadRequestError("New accounts must be assigned a predefined plan");
  }

  const apiKey = generateApiKey();
  const hashedApiKey = hashApiKey(apiKey)
  const account = await createAccount({ ...result.data, apiKeyHash:hashedApiKey});
  if (!account) {
    throw new Error("Account creation returned no record");
  }
  const { apiKeyHash, ...publicAccount } = account;
  res.status(201).json({ ...publicAccount, apiKey });
}

export async function handlerGetAccountById(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  const [account] = await getAccountById(req.params.id);
  if (!account) {
    throw new NotFoundError("Account not found");
  }
  res.status(200).json(account);
}
