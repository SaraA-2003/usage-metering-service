import type { Request, Response, NextFunction } from "express";
import { createAccount, getAccountById } from "../db/queries/accounts.js";
import { NotFoundError } from "../customErrors.js";

export async function handlerCreateAccount(req: Request, res: Response, next: NextFunction) {
  const account = await createAccount(req.body);
  res.status(201).json(account);
}

export async function handlerGetAccountById(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  const [account] = await getAccountById(req.params.id);
  if (!account) {
    throw new NotFoundError("Account not found");
  }
  res.status(200).json(account);
}
