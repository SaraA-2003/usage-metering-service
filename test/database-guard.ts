import "dotenv/config";

const name = process.env.DB_URL ? decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)) : "";
if (!name.endsWith("_test") || process.env.USAGE_TEST_DATABASE !== name) {
  throw new Error("Run tests with npm test; application database cleanup is forbidden.");
}
