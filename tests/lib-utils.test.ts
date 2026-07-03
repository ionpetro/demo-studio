import { test } from "node:test";
import assert from "node:assert/strict";
import { cn } from "../src/lib/utils.ts";

test("cn() joins plain string class names with a space", () => {
  assert.equal(cn("a", "b"), "a b");
});

test("cn() dedupes conflicting tailwind utility classes, last one wins", () => {
  assert.equal(cn("p-2", "p-4"), "p-4");
});

test("cn() drops falsy values (clsx behavior)", () => {
  assert.equal(cn("text-red-500", false && "text-blue-500", "text-lg"), "text-red-500 text-lg");
});

test("cn() drops undefined and null values", () => {
  assert.equal(cn("a", undefined, null, "b"), "a b");
});

test("cn() supports the object form, including only truthy keys", () => {
  assert.equal(cn({ "font-bold": true, italic: false }), "font-bold");
});

test("cn() with no args returns an empty string", () => {
  assert.equal(cn(), "");
});

test("cn() merges conflicting mx-* utilities to the last one while keeping non-conflicting my-1", () => {
  assert.equal(cn("mx-2", "mx-4", "my-1"), "mx-4 my-1");
});

test("cn() supports array form", () => {
  assert.equal(cn(["a", "b"], "c"), "a b c");
});

test("cn() merges conflicting classes across different argument shapes", () => {
  assert.equal(cn("p-2", { "p-4": true }, ["p-8"]), "p-8");
});
