import assert from "node:assert/strict";
import { test } from "node:test";
import { fmtClockLcd } from "../shared/sessions.ts";

test("the display clock shows days:hours:minutes from ten hours out", () => {
  assert.equal(fmtClockLcd(9 * 3600_000 + 59 * 60_000 + 59_000), "9:59:59");
  assert.equal(fmtClockLcd(10 * 3600_000), "0:10:00");
  assert.equal(fmtClockLcd(41 * 3600_000 + 11 * 60_000 + 5_000), "1:17:11");
  assert.equal(fmtClockLcd(115 * 3600_000 + 59 * 60_000 + 54_000), "4:19:59");
  assert.equal(fmtClockLcd(75_000), "01:15");
});
