import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { NotFoundError } from "../src/customErrors.ts";

// Replace database queries so these tests never connect to PostgreSQL.
const queries = {};
for (const [file, names] of Object.entries({
  accounts: ["createAccount", "getAccountById"],
  users: ["createUser", "getUserById"],
  plans: ["createPlan", "getPlans"],
})) {
  const namedExports = {};
  for (const name of names) {
    queries[name] = mock.fn();
    namedExports[name] = queries[name];
  }
  mock.module(`../src/db/queries/${file}.ts`, { namedExports });
}

const accounts = await import("../src/handlers/accounts.ts");
const users = await import("../src/handlers/users.ts");
const plans = await import("../src/handlers/plans.ts");

function response() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("Handlers", () => {
  for (const [entity, handler, query] of [
    ["account", accounts.handlerCreateAccount, queries.createAccount],
    ["user", users.handlerCreateUser, queries.createUser],
    ["plan", plans.handlerCreatePlan, queries.createPlan],
  ]) {
    it(`create ${entity} returns 201 and the created record`, async () => {
      const input = { name: "Example" };
      const record = { id: "example-id", ...input };
      query.mock.mockImplementation(async () => record);
      const res = response();
      await handler({ body: input }, res, mock.fn());
      assert.equal(res.statusCode, 201);
      assert.deepEqual(res.body, record);
      assert.deepEqual(query.mock.calls.at(-1).arguments, [input]);
    });
  }

  for (const [entity, handler, query] of [
    ["account", accounts.handlerGetAccountById, queries.getAccountById],
    ["user", users.handlerGetUserById, queries.getUserById],
  ]) {
    it(`get ${entity} returns one record and passes the requested ID`, async () => {
      const record = { id: "example-id" };
      query.mock.mockImplementation(async () => [record]);
      const res = response();
      await handler({ params: { id: record.id } }, res, mock.fn());
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, record);
      assert.deepEqual(query.mock.calls.at(-1).arguments, [record.id]);
    });

    it(`missing ${entity} throws NotFoundError`, async () => {
      query.mock.mockImplementation(async () => []);
      await assert.rejects(
        handler({ params: { id: "missing" } }, response(), mock.fn()),
        NotFoundError,
      );
    });
  }

  it("get plans returns the plans list", async () => {
    const records = [{ id: "plan-id" }];
    queries.getPlans.mock.mockImplementation(async () => records);
    const res = response();
    await plans.handlerGetPlans({}, res, mock.fn());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, records);
  });

  it("empty plans list throws NotFoundError", async () => {
    queries.getPlans.mock.mockImplementation(async () => []);
    await assert.rejects(plans.handlerGetPlans({}, response(), mock.fn()), {
      name: "Error",
      message: "No plans found",
    });
  });

  it("database failures propagate without sending a success response", async () => {
    const error = new Error("Database unavailable");
    queries.getPlans.mock.mockImplementation(async () => { throw error; });
    const res = response();
    await assert.rejects(plans.handlerGetPlans({}, res, mock.fn()), (actual) => actual === error);
    assert.equal(res.statusCode, undefined);
  });
});
