import assert from "node:assert/strict";
import test from "node:test";
import { listHcmOperations, describeHcmOperation, HcmError } from "../src/index.js";

test("public metadata discovery works without a connection and protects shared descriptors", () => {
  const first = listHcmOperations({ limit: 1 });
  assert.equal(first.operations.length, 1);
  assert.equal(first.nextCursor, 1);
  const second = listHcmOperations({ cursor: first.nextCursor, limit: 1 });
  assert.notEqual(first.operations[0]!.id, second.operations[0]!.id);
  assert.equal(first.total, second.total);
  Reflect.set(first.operations, "length", 0);
  assert.equal(listHcmOperations({ limit: 1 }).operations.length, 1);

  const id = "native.lds.putDoc";
  const descriptor = describeHcmOperation(id);
  assert.equal(listHcmOperations({ query: id, limit: 1 }).operations[0]!.id, id);
  assert.equal(descriptor.effect, "write");
  assert.ok(!("packagedVerification" in descriptor));
  assert.ok(Object.isFrozen(descriptor.inputSchema));
  assert.throws(() => Object.assign(descriptor.inputSchema, { type: "null" }), TypeError);
  assert.deepEqual(describeHcmOperation(id).inputSchema, descriptor.inputSchema);
  for (const [operation, code] of [
    ["../invalid", "INVALID_OPERATION_ID"],
    ["native.unknown.operation", "UNKNOWN_OPERATION"],
  ])
    assert.throws(
      () => describeHcmOperation(operation!),
      (error: unknown) => error instanceof HcmError && error.code === code,
    );
  assert.throws(
    () => listHcmOperations({ limit: 0 }),
    (error: unknown) => error instanceof HcmError && error.code === "INVALID_ARGUMENT",
  );
});
