import express from "express";
import { config } from "./config.js";
import { errorHandler } from "./middlewares.js";
import { handlerCreateAccount, handlerGetAccountById } from "./handlers/accounts.js";
import { handlerCreateUser, handlerGetUserById } from "./handlers/users.js";
import { handlerCreatePlan, handlerGetPlans } from "./handlers/plans.js";

const app = express();

// Middleware to parse incoming JSON requests
app.use(express.json());

//endpoints
app.post("/api/accounts", handlerCreateAccount);
app.get("/api/accounts/:id", handlerGetAccountById);

app.post("/api/users", handlerCreateUser);
app.get("/api.users/:id", handlerGetUserById);

app.post("/api/plans", handlerCreatePlan);
app.get("/api/plans", handlerGetPlans);

// Error Handler Middleware
app.use(errorHandler)

// Start the server
app.listen(config.api.port, () => {
  console.log(
    `Usage Metering Service running at http://localhost:${config.api.port}`
  );
});
