import {Response, Request,NextFunction } from "express"
import {z} from "zod"
import { BadRequestError, NotFoundError } from "../customErrors.js";
import { getUserById } from "../db/queries/users.js";
import { consume } from "../services/consumptions.js";

const consumptionSchema = z.strictObject({
  userId: z.uuid(),
  units: z.number().int().positive().max(2147483647),
  requestId: z.string().trim().min(1).max(255),
});
export async function handlerConsume (req: Request, res: Response, next: NextFunction){
    const result = consumptionSchema.safeParse(req.body)
    if (!result.success) {
        throw new BadRequestError(result.error.issues.map((issue) => issue.message).join("; "));
    }
    const accountId = req.account!.id;
    const { userId, units, requestId } = result.data;
    //Calls consume service
    const outcome = await consume(accountId, userId, units, requestId);

    //This tells the client it reused a request ID for a different operation.
    if (outcome.kind === "conflict") {
        res.status(409).json({
            error: "Request ID was already used with a different user or units",
        });
        return;
    }
    if (outcome.kind === "account_not_found") {
        throw new NotFoundError("Account not found");
    }

    if (outcome.kind === "user_not_found") {
        throw new NotFoundError("User not found");
    }
    //This returns the saved decision without consuming again.
    if (outcome.kind === "replayed") {
        res.status(200).json({
            outcome: outcome.outcome,
            replayed: true,
        });
        return;
    }
    //send the response for a new accepted or rejected request.
    res.status(200).json({
        outcome: outcome.outcome,
        remaining: outcome.remaining,
        replayed: false,
    });

}

