import express from "express";
import { authenticateApiKey, errorHandler } from "./middlewares.js";
import { handlerCreateAccount, handlerGetAccountById } from "./handlers/accounts.js";
import { handlerCreateUser, handlerGetUserById } from "./handlers/users.js";
import { handlerCreatePlan, handlerGetPlans } from "./handlers/plans.js";

// Keep listening in index.ts so tests can start this app on their own port.
export const app = express();

// Middleware to parse incoming JSON requests
app.use(express.json());

//endpoints
app.post("/api/accounts", handlerCreateAccount);
app.get("/api/accounts/:id", authenticateApiKey, handlerGetAccountById);

app.post("/api/users", authenticateApiKey,handlerCreateUser);
app.get("/api/users/:id", authenticateApiKey, handlerGetUserById);

app.post("/api/plans", handlerCreatePlan);
app.get("/api/plans", handlerGetPlans);

// Express 5 forwards rejected async handlers here; this must follow the routes.
app.use(errorHandler)

