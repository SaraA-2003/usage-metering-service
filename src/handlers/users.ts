import type { Request, Response, NextFunction } from "express";
import { createUser, getUserById } from "../db/queries/users.js";
import { NotFoundError } from "../customErrors.js";

export async function handlerCreateUser(req: Request, res: Response, next: NextFunction) {
  const user = await createUser(req.body);
  res.status(201).json(user);
}

export async function handlerGetUserById(req: Request<{ id: string }>, res: Response, next: NextFunction) {
  const [user] = await getUserById(req.params.id);
  if (!user) {
    throw new NotFoundError("User not found");
  }
  res.status(200).json(user);
}
