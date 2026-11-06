import assert from "node:assert/strict";
import { test } from "node:test";
import { robloxLookup } from "../worker/roblox-users.ts";

const env = { DB: {} as D1Database };
const json = (b: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(b), { status: 200, ...init });
const stub = (fn: (url: string, init?: RequestInit) => Response | null) => {
  globalThis.fetch = (async (u: string, init?: RequestInit) => {
    const r = fn(String(u), init);
    if (!r) throw new Error("network");
    return r;
  }) as typeof fetch;
};

test("exact lookup finds a user by ID, ignoring case", async () => {
  stub(() => json({ data: [{ id: 111, name: "KiriCubi", displayName: "K" }] }));
  assert.deepEqual(await robloxLookup(env, "kiricubi"), { found: { id: "111", username: "KiriCubi", displayName: "K" } });
});

test("retries the POST with the CSRF token Roblox returns", async () => {
  stub((_u, init) =>
    (init?.headers as Record<string, string>)?.["x-csrf-token"] === "t"
      ? json({ data: [{ id: 5, name: "abc", displayName: "abc" }] })
      : new Response("", { status: 403, headers: { "x-csrf-token": "t" } }),
  );
  assert.deepEqual(await robloxLookup(env, "abc"), { found: { id: "5", username: "abc", displayName: "abc" } });
});

test("falls back to search when the exact lookup fails", async () => {
  stub((u) => (u.includes("/search") ? json({ data: [{ id: 9, name: "abc", displayName: "abc" }] }) : new Response("", { status: 500 })));
  assert.deepEqual(await robloxLookup(env, "abc"), { found: { id: "9", username: "abc", displayName: "abc" } });
});

test("falls back to the profile redirect", async () => {
  stub((u) => (u.includes("/users/profile") ? new Response("", { status: 302, headers: { location: "/users/77/profile" } }) : null));
  assert.deepEqual(await robloxLookup(env, "abc"), { found: { id: "77", username: "abc", displayName: "abc" } });
});

test("no such user is reported as none, not unreachable", async () => {
  stub(() => json({ data: [] }));
  assert.deepEqual(await robloxLookup(env, "nobody"), { none: true });
});

test("everything failing is unreachable", async () => {
  stub(() => null);
  assert.deepEqual(await robloxLookup(env, "abc"), { unreachable: true });
});
