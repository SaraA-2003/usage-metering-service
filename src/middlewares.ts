import type { Request, Response, NextFunction } from "express";
import type { Account } from "./db/schema.js";
import { hashApiKey } from "./auth.js";
import { getAccountByApiKeyHash } from "./db/queries/accounts.js";

import { BadRequestError,ForbiddenError,NotFoundError,UnauthorizedError } from "./customErrors.js";

declare global {
    namespace Express {
        interface Request {
            account?:{
                id: string;
                planId: string;
            };
        }
    }
}

export async function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.get("X-API-Key");
    if (!apiKey) {
        throw new UnauthorizedError("Missing API key");
    }
    const apiKeyHash = hashApiKey(apiKey)
    const account = await getAccountByApiKeyHash(apiKeyHash);
    if (!account) {
        throw new UnauthorizedError("Invalid API key");
    }

    req.account = { 
        id: account.id,
        planId: account.planId
}
    next();
}

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
        if (res.headersSent) {
        next(err);
        return;
    }
    if (err instanceof BadRequestError) {
        res.status(400).json({ error: err.message });
    } else if (err instanceof UnauthorizedError) {
        res.status(401).json({ error: err.message });
    } else if (err instanceof ForbiddenError) {
        res.status(403).json({ error: err.message });
    } else if (err instanceof NotFoundError) {
        res.status(404).json({ error: err.message });
    }
    else {
        console.error(err);
        res.status(500).json({ error: "Something went wrong on our end"});
    }
}
