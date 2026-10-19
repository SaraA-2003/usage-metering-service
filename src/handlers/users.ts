import type { Request, Response, NextFunction } from "express";
import { createUser, getUserById, getUserUsage, updateUserPlan } from "../db/queries/users.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../customErrors.js";
import z from "zod";
import { getPlanById } from "../db/queries/plans.js";

const createUserSchema = z.strictObject({
  planId: z.uuid(),
});

const usageQuerySchema = z.strictObject({
  month: z.string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM format")
    .optional(),
});

//-----------------------------------------
export async function handlerCreateUser(req: Request, res: Response, next: NextFunction) {
  const accountId = req.account!.id;

  const result = createUserSchema.safeParse(req.body);
    if (!result.success) {
    throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  const plan =  await getPlanById(result.data.planId);
  if(!plan){
    throw new NotFoundError("The requested plan was not found");
  }
   if(plan.type != "user"){
    throw new BadRequestError("Users must be assigned a user plan, not an account plan");
   }
   //Custom plan
   if(!plan.isPredefined){
    const accountIdForCustomPlan = plan.accountId
    if(accountId !== accountIdForCustomPlan){
        throw new ForbiddenError("You cannot assign a custom plan owned by another account");
    }
   }
  const user = await createUser({...result.data, accountId});
  res.status(201).json(user);
}

//-----------------------------------------
export async function handlerGetUserById(req: Request, res: Response, next: NextFunction) {
  const userId = req.params.id
  if (!z.uuid().safeParse(userId).success || typeof userId !== "string") {
    throw new BadRequestError("User ID must be a valid UUID");
  }
  const user = await getUserById(userId, req.account!.id);
  if (!user) {
    throw new NotFoundError("User not found");
  }
  res.status(200).json(user);
}

//-----------------------------------------
export async function handlerSwitchUserPlan(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  if (!z.uuid().safeParse(req.params.id).success) {
    throw new BadRequestError("User ID must be a valid UUID");
  }
  const result = createUserSchema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  const accountId = req.account!.id;
  const user = await getUserById(req.params.id, accountId);
  if (!user) {
    throw new NotFoundError("User not found");
  }
  const plan = await getPlanById(result.data.planId);
  if (!plan) {
    throw new NotFoundError("The requested plan was not found");
  }
  if (plan.type !== "user") {
    throw new BadRequestError("Users must be assigned a user plan, not an account plan");
  }
  if (!plan.isPredefined && plan.accountId !== accountId) {
    throw new ForbiddenError("You cannot assign a custom plan owned by another account");
  }
  const updatedUser = await updateUserPlan(user.id, accountId, plan.id);
  if (!updatedUser) {
    throw new NotFoundError("User not found");
  }
  res.status(200).json(updatedUser);
}

//-----------------------------------------
export async function handlerGetUserUsage(req: Request<{ id: string }>, res: Response, next: NextFunction)
 {
  if (!z.uuid().safeParse(req.params.id).success) {
    throw new BadRequestError("User ID must be a valid UUID");
  }
  //Checks that the user belongs to the authenticated account.
  const user = await getUserById(req.params.id, req.account!.id);

  if (!user) {
    throw new NotFoundError("User not found");
  }

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
  const usage = await getUserUsage(user.id, month);
  const consumedUnits = usage?.consumedUnits ?? 0;
  const plan = await getPlanById(user.planId);
  if (!plan) {
    throw new Error("An assigned user plan was not found");
  }

  const remainingUnits = Math.max(0, plan.monthlyAllowance - consumedUnits);
  res.status(200).json({
    userId: user.id,
    accountId: user.accountId,
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