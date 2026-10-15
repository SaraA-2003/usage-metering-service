import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { errorHandler } from "../src/middlewares.ts";
import {
  BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError,
} from "../src/customErrors.ts";

describe("errorHandler", () => {
  for (const [ErrorClass, status] of [
    [BadRequestError, 400], [UnauthorizedError, 401],
    [ForbiddenError, 403], [NotFoundError, 404],
  ]) {
    it(`${ErrorClass.name} produces HTTP ${status}`, () => {
      const res = { status: mock.fn(() => res), json: mock.fn() };
      const next = mock.fn();
      errorHandler(new ErrorClass("Example message"), {}, res, next);
      assert.deepEqual(res.status.mock.calls[0].arguments, [status]);
      assert.deepEqual(res.json.mock.calls[0].arguments, [{ error: "Example message" }]);
      assert.equal(next.mock.callCount(), 0);
    });
  }

  it("unexpected errors return 500 without exposing internal details", (t) => {
    t.mock.method(console, "error", () => {});
    const res = { status: mock.fn(() => res), json: mock.fn() };
    errorHandler(new Error("Sensitive database details"), {}, res, mock.fn());
    assert.deepEqual(res.status.mock.calls[0].arguments, [500]);
    assert.deepEqual(res.json.mock.calls[0].arguments, [
      { error: "Something went wrong on our end" },
    ]);
  });

  it("errors are forwarded when response headers were already sent", () => {
    const error = new Error("Late error");
    const next = mock.fn();
    const res = { headersSent: true, status: mock.fn(), json: mock.fn() };
    errorHandler(error, {}, res, next);
    assert.deepEqual(next.mock.calls[0].arguments, [error]);
    assert.equal(res.status.mock.callCount(), 0);
    assert.equal(res.json.mock.callCount(), 0);
  });
});
