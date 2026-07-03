import { test } from "node:test";
import assert from "node:assert/strict";
import { apiBase, apiUrl } from "../src/lib/api-base.ts";

// apiBase() re-reads process.env.NEXT_PUBLIC_API_URL / process.env.PUBLIC_URL
// on every call (no caching), so we save/restore both around every test case
// to avoid bleeding state between cases. We use `delete` (not `= undefined`)
// to truly unset a var, since process.env coerces assigned values to strings
// (`String(undefined) === "undefined"`, which is truthy).
const ORIG_NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL;
const ORIG_PUBLIC_URL = process.env.PUBLIC_URL;

function resetEnv() {
  if (ORIG_NEXT_PUBLIC_API_URL === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = ORIG_NEXT_PUBLIC_API_URL;
  if (ORIG_PUBLIC_URL === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = ORIG_PUBLIC_URL;
}

test("apiBase() with neither env var set returns empty string", (t) => {
  t.after(resetEnv);
  delete process.env.NEXT_PUBLIC_API_URL;
  delete process.env.PUBLIC_URL;

  assert.equal(apiBase(), "");
});

test("apiBase() with only PUBLIC_URL set strips a trailing slash", (t) => {
  t.after(resetEnv);
  delete process.env.NEXT_PUBLIC_API_URL;
  process.env.PUBLIC_URL = "https://api.example.com/";

  assert.equal(apiBase(), "https://api.example.com");
});

test("apiBase() with only NEXT_PUBLIC_API_URL set (no trailing slash) returns it as-is", (t) => {
  t.after(resetEnv);
  process.env.NEXT_PUBLIC_API_URL = "https://a.example.com";
  delete process.env.PUBLIC_URL;

  assert.equal(apiBase(), "https://a.example.com");
});

test("apiBase() with both set prefers NEXT_PUBLIC_API_URL (precedence in the || chain)", (t) => {
  t.after(resetEnv);
  process.env.NEXT_PUBLIC_API_URL = "https://a.example.com";
  process.env.PUBLIC_URL = "https://b.example.com";

  assert.equal(apiBase(), "https://a.example.com");
});

test("apiBase() with NEXT_PUBLIC_API_URL set to empty string falls through to PUBLIC_URL", (t) => {
  t.after(resetEnv);
  process.env.NEXT_PUBLIC_API_URL = "";
  process.env.PUBLIC_URL = "https://b.example.com";

  // "" is falsy in the `||` chain, so it should fall through to PUBLIC_URL.
  assert.equal(apiBase(), "https://b.example.com");
});

test("apiBase() with both env vars empty string returns empty string", (t) => {
  t.after(resetEnv);
  process.env.NEXT_PUBLIC_API_URL = "";
  process.env.PUBLIC_URL = "";

  assert.equal(apiBase(), "");
});

test("apiUrl() with empty base: leading-slash and no-leading-slash paths produce the same result", (t) => {
  t.after(resetEnv);
  delete process.env.NEXT_PUBLIC_API_URL;
  delete process.env.PUBLIC_URL;

  assert.equal(apiUrl("/foo/bar"), "/foo/bar");
  assert.equal(apiUrl("foo/bar"), "/foo/bar");
  assert.equal(apiUrl("/foo/bar"), apiUrl("foo/bar"));
});

test("apiUrl() with a non-empty base: leading-slash and no-leading-slash paths produce the same result", (t) => {
  t.after(resetEnv);
  process.env.NEXT_PUBLIC_API_URL = "https://a.example.com";
  delete process.env.PUBLIC_URL;

  assert.equal(apiUrl("/foo/bar"), "https://a.example.com/foo/bar");
  assert.equal(apiUrl("foo/bar"), "https://a.example.com/foo/bar");
  assert.equal(apiUrl("/foo/bar"), apiUrl("foo/bar"));
});

test("apiUrl('/') with a non-empty base has no double slash", (t) => {
  t.after(resetEnv);
  process.env.NEXT_PUBLIC_API_URL = "https://a.example.com";
  delete process.env.PUBLIC_URL;

  assert.equal(apiUrl("/"), "https://a.example.com/");
});

test("apiUrl('/') with an empty base returns just '/'", (t) => {
  t.after(resetEnv);
  delete process.env.NEXT_PUBLIC_API_URL;
  delete process.env.PUBLIC_URL;

  assert.equal(apiUrl("/"), "/");
});
