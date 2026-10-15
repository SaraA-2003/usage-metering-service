import type { Request, Response, NextFunction } from "express";

import { BadRequestError,ForbiddenError,NotFoundError,UnauthorizedError } from "./customErrors.js";


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
