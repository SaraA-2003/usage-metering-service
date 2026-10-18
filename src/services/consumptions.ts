import { db } from "../db/index.js";
import { getAccountForUpdate, getAccountMonthlyUsage, getConsumptionPlan, getConsumptionRequest, getConsumptionUser, getUserMonthlyUsage,  incrementAccountUsage, incrementUserUsage, saveConsumptionRequest } from "../db/queries/consumptions.js";
import { ConsumptionRequest } from "../db/schema.js";

type ConsumeResult =
  | { kind: "account_not_found" }
  | { kind: "user_not_found" }
  | { kind: "conflict" }
  | { kind: "replayed"; outcome: ConsumptionRequest}
  | {
      kind: "accepted" | "rejected";
      outcome: ConsumptionRequest;
      remaining: {
        account: number;
        user: number;
      };
    };

 
export async function consume(
  accountId: string,
  userId: string,
  units: number,
  requestId: string,
):Promise<ConsumeResult>{
// Group consumption operations in one transaction so they commit together
// or roll back if an error occurs. 
    return db.transaction(async(tx) => {

        const account = await getAccountForUpdate(tx, accountId);
        if (!account) {
            return { kind: "account_not_found" } as const;
        }
        const user = await getConsumptionUser(tx, userId, accountId);
        if (!user) {
            return { kind: "user_not_found" } as const;
        }
        //Checks whether this account has already processed the request ID
        const existingRequest = await getConsumptionRequest(tx, accountId, requestId);
        if (existingRequest) {
            //Different user or units means the client reused the ID for a different operation.
            if (
                existingRequest.userId !== userId ||
                existingRequest.units !== units
            ) {
                return { kind: "conflict" } as const;
            }
            //Matching values mean it’s a retry: return the saved outcome without consuming again.
            return {
                kind: "replayed",
                outcome: existingRequest,
            } as const;
        }
        //Calculates the current UTC month. output -> ex: "2026-11-01"
        const now = new Date();
        const month = [
        now.getUTCFullYear(),
        String(now.getUTCMonth() + 1).padStart(2, "0"),
        "01",
        ].join("-");

        //Account
        const accountUsage = await getAccountMonthlyUsage(tx, accountId, month);
        const accountConsumed = accountUsage?.consumedUnits ?? 0;// No monthly row means zero units consumed.
        //User
        const userUsage = await getUserMonthlyUsage(tx, userId, month);
        const userConsumed = userUsage?.consumedUnits ?? 0;

        //Plan
        const accountPlan = await getConsumptionPlan(tx, account.planId);
        const userPlan = await getConsumptionPlan(tx, user.planId);
        if (!accountPlan || !userPlan) {
            throw new Error("An assigned plan was not found");
        }
        let blocker: {
            level: "account" | "user";
            rule: "monthly_allowance" | "max_units_per_request";
            } | undefined;
        if (units > accountPlan.maxUnitsPerRequest) {
        // Reject: account's maximum units per request exceeded.
            blocker = {
                level: "account",
                rule: "max_units_per_request",
            };
        }
        else if (units > accountPlan.monthlyAllowance - accountConsumed) {
            blocker = {
                level: "account",
                rule: "monthly_allowance",
            };
        } else if (units > userPlan.maxUnitsPerRequest) {
            blocker = {
                level: "user",
                rule: "max_units_per_request",
            };
        } else if (units > userPlan.monthlyAllowance - userConsumed) {
            blocker = {
                level: "user",
                rule: "monthly_allowance",
            };
        }

        //Handle rejection
        if (blocker) {
        const outcome = await saveConsumptionRequest(tx, {
            accountId,
            userId,
            requestId,
            units,
            month,
            decision: "rejected",
            blockingLevel: blocker.level,
            blockingRule: blocker.rule,
        });

        if (!outcome) {
            throw new Error("Saving consumption outcome returned no record");
        }

        return {
            kind: "rejected",
            outcome,
            remaining: {
                account: Math.max(
                0,
                accountPlan.monthlyAllowance - accountConsumed,
                ),
                user: Math.max(
                0,
                userPlan.monthlyAllowance - userConsumed,
                ),
            },
            } as const;
        }

        const updatedAccountUsage = await incrementAccountUsage(
        tx, accountId, month, units,
        );

        const updatedUserUsage = await incrementUserUsage(
        tx, userId, month, units,
        );

        if (!updatedAccountUsage || !updatedUserUsage) {
            throw new Error("Usage update returned no record");
        }
        //Accepted
        const outcome = await saveConsumptionRequest(tx, {
        accountId,
        userId,
        requestId,
        units,
        month,
        decision: "accepted",
        blockingLevel: null,
        blockingRule: null,
        });
        if (!outcome) {
            throw new Error("Saving consumption outcome returned no record");
        }

        return {
            kind: "accepted",
            outcome,
            remaining: {
                account: Math.max(
                0,
                accountPlan.monthlyAllowance - updatedAccountUsage.consumedUnits,
                ),
                user: Math.max(
                0,
                userPlan.monthlyAllowance - updatedUserUsage.consumedUnits,
                ),
            },
            } as const;
    });
   
}