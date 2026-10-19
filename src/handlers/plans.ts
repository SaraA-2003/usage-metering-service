import type { Request, Response, NextFunction } from "express";
import { createPlan, getPlanById, getPlans, getPlansByName, getPredefinedPlans, updatePlan } from "../db/queries/plans.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../customErrors.js";
import { z } from "zod";


const createPlanSchema = z.strictObject({
  name: z.string().trim().min(1),
  type: z.enum(["account", "user"]),
  monthlyAllowance: z.number().int().min(0).max(2147483647),
  maxUnitsPerRequest: z.number().int().min(1).max(2147483647),
});

const updatePlanSchema = createPlanSchema
  .omit({ type: true })
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });


export async function handlerCreatePlan(req: Request, res: Response, next: NextFunction) {
  const result = createPlanSchema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));
  }

  const matchingPlans = await getPlansByName(result.data.name);
  if (matchingPlans.some((plan) =>
    plan.type === result.data.type &&
    (plan.isPredefined || plan.accountId === req.account!.id)
  )) {
    throw new ConflictError("A plan with this name and type already exists");
  }
  
  const plan = await createPlan({
    ...result.data,
    accountId: req.account!.id,
    isPredefined: false,
  });
  res.status(201).json(plan);
}

export async function handlerGetPlans(req: Request, res: Response, next: NextFunction) {
  const plans = await getPlans(req.account!.id);
  if (plans.length === 0) {
    throw new NotFoundError("No plans found");
  }
  res.status(200).json(plans);
}

export async function handlerUpdatePlan(req: Request, res: Response, next: NextFunction) {
  const planId = req.params.id;
  if (typeof planId !== "string" || !z.uuid().safeParse(planId).success) {
    throw new BadRequestError("Plan ID must be a valid UUID");
  }
  const result = updatePlanSchema.safeParse(req.body);
  if (!result.success) {
    throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  const accountId = req.account!.id;
  const plan = await getPlanById(planId);
  if (!plan) {
    throw new NotFoundError("Plan not found");
  }
  if (plan.isPredefined) {
    throw new ForbiddenError("Predefined plans cannot be updated");
  }
  if (plan.accountId !== accountId) {
    throw new ForbiddenError("You cannot update a custom plan owned by another account");
  }
  if (result.data.name !== undefined) {
    const matchingPlans = await getPlansByName(result.data.name);
    if (matchingPlans.some((existing) =>
      existing.id !== planId && existing.type === plan.type &&
      (existing.isPredefined || existing.accountId === accountId)
    )) {
      throw new ConflictError("A plan with this name and type already exists");
    }
  }
  const updatedPlan = await updatePlan(planId, accountId, result.data);
  if (!updatedPlan) {
    throw new NotFoundError("Plan not found");
  }
  res.status(200).json(updatedPlan);
}

export async function handlerGetPredefinedPlans(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const plans = await getPredefinedPlans();
  res.status(200).json(plans);
}