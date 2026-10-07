const test = require("node:test");
const assert = require("node:assert");
const { greet, add } = require("../src/app");

test("greet with no name", () => {
  assert.strictEqual(greet(), "Hello World");
});

test("greet with a name", () => {
  assert.strictEqual(greet("Ashutosh"), "Hello Ashutosh");
});

test("add", () => {
  assert.strictEqual(add(2, 3), 5);
});
