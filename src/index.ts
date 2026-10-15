import express from "express";
import { config } from "./config.js";
import { errorHandler } from "./middlewares.js";

const app = express();

// Middleware to parse incoming JSON requests
app.use(express.json());

//endpoints


// Error Handler Middleware
app.use(errorHandler)

// Start the server
app.listen(config.api.port, () => {
  console.log(
    `Usage Metering Service running at http://localhost:${config.api.port}`
  );
});