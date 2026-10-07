const test = require("node:test");
const assert = require("node:assert");
const { recordVisit, getVisits, health } = require("../src/app");

test("starts at zero", () => {
  assert.strictEqual(getVisits(), 0);
});

test("counts a visit", () => {
  assert.strictEqual(recordVisit(), 1);
});

test("health reports ok", () => {
  assert.strictEqual(health().status, "ok");
});
