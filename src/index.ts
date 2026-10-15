import { app } from "./app.js";
import { config } from "./config.js";

// Start the server
app.listen(config.api.port, () => {
  console.log(
    `Usage Metering Service running at http://localhost:${config.api.port}`
  );
});
