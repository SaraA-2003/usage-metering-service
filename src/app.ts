import express from "express";
import { authenticateApiKey, errorHandler } from "./middlewares.js";
import { handlerCreateAccount, handlerGetAccountById, handlerSwitchAccountPlan } from "./handlers/accounts.js";
import { handlerCreateUser, handlerGetUserById, handlerSwitchUserPlan } from "./handlers/users.js";
import { handlerCreatePlan, handlerGetPlans, handlerUpdatePlan } from "./handlers/plans.js";

// Keep listening in index.ts so tests can start this app on their own port.
export const app = express();

// Middleware to parse incoming JSON requests
app.use(express.json());

//endpoints
app.post("/api/accounts", handlerCreateAccount);
app.get("/api/accounts/:id", authenticateApiKey, handlerGetAccountById);
app.patch("/api/accounts/:id/plan", authenticateApiKey, handlerSwitchAccountPlan);


app.post("/api/users", authenticateApiKey,handlerCreateUser);
app.get("/api/users/:id", authenticateApiKey, handlerGetUserById);
app.patch("/api/users/:id/plan", authenticateApiKey, handlerSwitchUserPlan);

app.post("/api/plans", authenticateApiKey, handlerCreatePlan);
app.get("/api/plans", authenticateApiKey, handlerGetPlans);
app.put("/api/plans/:id", authenticateApiKey, handlerUpdatePlan);

// Express forwards rejected async handlers here; this must follow the routes.
app.use(errorHandler)

