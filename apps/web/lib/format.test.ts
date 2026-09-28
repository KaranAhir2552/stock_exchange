import assert from "node:assert/strict";
import { test } from "node:test";
import { bps, duration, toAtoms } from "./format.ts";

test("toAtoms parses user input to atoms, flooring extra decimals", () => {
  assert.equal(toAtoms("1.5", 6), 1_500_000n);
  assert.equal(toAtoms("12", 8), 1_200_000_000n);
  assert.equal(toAtoms(".5", 2), 50n);
  assert.equal(toAtoms("0.0000019", 6), 1n);
  for (const bad of ["", ".", "abc", "1.2.3", "-1", "1e5"]) assert.equal(toAtoms(bad, 6), 0n, bad);
});

test("labels", () => {
  assert.equal(bps(62), "0.62%");
  assert.equal(duration(65_760), "18h 16m");
  assert.equal(duration(2 * 86_400 + 3 * 3_600), "2d 3h");
});
