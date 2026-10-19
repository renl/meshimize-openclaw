import { test } from "node:test";
import assert from "node:assert/strict";
import { selectImages } from "./image-selection.mjs";

test("historical selection remains distinct from replacement", () => {
  assert.equal(selectImages({}).replacement, false);
});
test("replacement records all exact local identities", () => {
  const ids = ["a", "b", "c"].map((c) => `sha256:${c.repeat(64)}`);
  assert.deepEqual(
    selectImages({
      MESHIMIZE_TEST_RUNTIME: ids[0],
      MESHIMIZE_TEST_SERVER: ids[1],
      MESHIMIZE_TEST_POSTGRES: ids[2],
    }),
    { runtime: ids[0], server: ids[1], postgres: ids[2], replacement: true },
  );
});
test("partial, mutable, empty and malformed replacement fails closed", () => {
  for (const value of ["sha256:" + "a".repeat(64), "postgres:16", "", "sha256:bad"])
    assert.throws(() => selectImages({ MESHIMIZE_TEST_RUNTIME: value }));
  assert.throws(() =>
    selectImages({
      MESHIMIZE_TEST_RUNTIME: "node:24",
      MESHIMIZE_TEST_SERVER: "server:latest",
      MESHIMIZE_TEST_POSTGRES: "postgres:16",
    }),
  );
});
