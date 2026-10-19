import type { Request, Response, NextFunction } from "express";
import { createAccount, getAccountById, getAccountUsage, updateAccountPlan } from "../db/queries/accounts.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../customErrors.js";
import { z } from "zod";
import { generateApiKey, hashApiKey } from "../auth.js";
import { getPlanById } from "../db/queries/plans.js";

const createAccountSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  planId: z.uuid(), 
});

const usageQuerySchema = z.strictObject({
  month: z.string()
    .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM format")
    .optional(),
});
//----------------------------------------------
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

  // Store the hash and return the original key only in this creation response.
  const apiKey = generateApiKey();
  const hashedApiKey = hashApiKey(apiKey)
  const account = await createAccount({ ...result.data, apiKeyHash:hashedApiKey});
  if (!account) {
    throw new Error("Account creation returned no record");
  }
  const { apiKeyHash, ...publicAccount } = account;
  res.status(201).json({ ...publicAccount, apiKey });
}

//----------------------------------------------
export async function handlerGetAccountById(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  if (!z.uuid().safeParse(req.params.id).success) {
    throw new BadRequestError("Account ID must be a valid UUID");
  }
  // Use the same 404 for missing and other accounts to avoid revealing their existence.
  if (req.params.id !== req.account!.id) {
    throw new NotFoundError("Account not found");
  }
  const [account] = await getAccountById(req.params.id);
  if (!account) {
    throw new NotFoundError("Account not found");
  }
  const { apiKeyHash, ...publicAccount } = account;
  res.status(200).json(publicAccount);
}

//----------------------------------------------
export async function handlerSwitchAccountPlan( req: Request<{ id: string }>, res: Response, next: NextFunction,
) 
{
  if (!z.uuid().safeParse(req.params.id).success) {
    throw new BadRequestError("Account ID must be a valid UUID");
  }
  const result = z.strictObject({ planId: z.uuid() }).safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  if (req.params.id !== req.account!.id) {
    //Prevents revealing whether the account exists.
    throw new NotFoundError("Account not found");
  }
  const plan = await getPlanById(result.data.planId);
  if (!plan) {
    throw new NotFoundError("The requested plan was not found");
  }
  if (plan.type !== "account") {
    throw new BadRequestError("Accounts must be assigned an account plan, not a user plan");
  }
  if (!plan.isPredefined && plan.accountId !== req.account!.id) {
    throw new ForbiddenError("You cannot assign a custom plan owned by another account");
  }
  const account = await updateAccountPlan(req.params.id, result.data.planId);
  if (!account) {
    throw new NotFoundError("Account not found");
  }
  const { apiKeyHash, ...publicAccount } = account;
  res.status(200).json(publicAccount);
}

//----------------------------------------------
export async function handlerGetAccountUsage(req: Request<{ id: string }>, res: Response, next: NextFunction) 
{
  if (!z.uuid().safeParse(req.params.id).success) {
    throw new BadRequestError("Account ID must be a valid UUID");
  }

  if (req.params.id !== req.account!.id) {
    throw new NotFoundError("Account not found");
  }
  // Checks whether the month query parameter is provided and validates its format.
  const result = usageQuerySchema.safeParse(req.query);

  if (!result.success) {
    throw new BadRequestError(
      result.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  const now = new Date();
  const currentMonth = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
  ].join("-");

  const requestedMonth = result.data.month ?? currentMonth;

  if (requestedMonth > currentMonth) {
    throw new BadRequestError("Month cannot be after the current UTC month");
  }
  const month = `${requestedMonth}-01`;
// Retrieves the account's usage data.
  const usage = await getAccountUsage(req.account!.id, month);
  const consumedUnits = usage?.consumedUnits ?? 0;
  //Retrieved the account’s assigned plan:
  const plan = await getPlanById(req.account!.planId);
  if (!plan) {
    throw new Error("An assigned account plan was not found");
  }
  //Calculates the remaining allowance:
  const remainingUnits = Math.max(0,plan.monthlyAllowance - consumedUnits);
  // Returns the plan limits and the account's total usage for the current month.
  res.status(200).json({
    accountId: req.account!.id,
    month,
    plan: {
      id: plan.id,
      name: plan.name,
      monthlyAllowance: plan.monthlyAllowance,
      maxUnitsPerRequest: plan.maxUnitsPerRequest,
    },
    consumedUnits,
    remainingUnits,
  });
}


