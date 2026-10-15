import type { Request, Response, NextFunction } from "express";
import { createPlan, getPlans } from "../db/queries/plans.js";
import { NotFoundError } from "../customErrors.js";

export async function handlerCreatePlan(req: Request, res: Response, next: NextFunction) {
  const plan = await createPlan(req.body);
  res.status(201).json(plan);
}

export async function handlerGetPlans(req: Request, res: Response, next: NextFunction) {
  const plans = await getPlans();
  if (plans.length === 0) {
    throw new NotFoundError("No plans found");
  }
  res.status(200).json(plans);
}
