import { app } from "./app.js";
import { config } from "./config.js";
import { seedPredefinedPlans } from "./db/seed.js";

//Seed the database
await seedPredefinedPlans();
// Start the server
app.listen(config.api.port, () => {
  console.log(
    `Usage Metering Service running at http://localhost:${config.api.port}`
  );
});
