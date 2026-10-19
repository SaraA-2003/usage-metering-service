import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "../src/config.js";

const prompt = createInterface({
  input: stdin,
  output: stdout,
});

const baseUrl = `http://localhost:${config.api.port}`;
const apiKey = (
  await prompt.question("Enter your account API key: ")
).trim();

if (!apiKey) {
  throw new Error("ACCOUNT_API_KEY is required");
}

const limit = 5;
let offset = 0;