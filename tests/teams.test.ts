import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanRoles, hasAny, PANEL_ROLES, parseRoles } from "../shared/teams.ts";

test("parseRoles keeps known roles in order", () => {
  assert.deepEqual(parseRoles("driver,principal,bogus"), ["principal", "driver"]);
  assert.deepEqual(parseRoles(""), []);
});

test("cleanRoles rejects empty and unknown roles", () => {
  assert.equal(cleanRoles([]), null);
  assert.equal(cleanRoles(["boss"]), null);
  assert.equal(cleanRoles("driver"), null);
  assert.deepEqual(cleanRoles(["driver", "driver", "race_engineer"]), ["race_engineer", "driver"]);
});

test("only staff roles open the panel", () => {
  assert.equal(hasAny(["driver"], PANEL_ROLES), false);
  assert.equal(hasAny(["driver", "race_engineer"], PANEL_ROLES), true);
});
