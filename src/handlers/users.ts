import type { Request, Response, NextFunction } from "express";
import { createUser, getUserById } from "../db/queries/users.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../customErrors.js";
import z from "zod";
import { getPlanById } from "../db/queries/plans.js";

const createUserSchema = z.strictObject({
  planId: z.uuid(),
})
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
