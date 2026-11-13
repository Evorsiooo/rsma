import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_EMBED, embedTags, raceEmbed, routeOf, sessionEmbed } from "../shared/embed.ts";
import type { RaceSummary, SessionInfo } from "../shared/types.ts";

const session = { id: "s1", raceId: "r1", name: "Practice 1", type: "practice" as const, startsAt: 0, endsAt: 1, selfTimed: false, staging: false };
const race = (over: Partial<RaceSummary> = {}): RaceSummary => ({ id: "r1", name: "Test Race", expiresAt: 0, sessions: [session], ended: false, ...over });

test("public pages have their own preview and everything else gets the site-wide card", () => {
  assert.equal((routeOf("/driver-registration") as { embed: { title: string } }).embed.title, "Driver Registration");
  assert.equal((routeOf("/schedule") as { embed: { title: string } }).embed.title, "Schedule");
  assert.equal((routeOf("/terms/") as { embed: { title: string } }).embed.title, "Terms of service");
  for (const gated of ["/admin", "/my-team", "/my-team/t1", "/session/s1/steward", "/session/s1/driver", "/session/s1/team/t1", "/session/s1/register", "/nope"]) {
    assert.deepEqual(routeOf(gated), { kind: "static", embed: DEFAULT_EMBED }, gated);
  }
});

test("session and race links are looked up by id", () => {
  assert.deepEqual(routeOf("/session/abc"), { kind: "session", id: "abc" });
  assert.deepEqual(routeOf("/race/xyz"), { kind: "race", id: "xyz" });
});

test("a session preview names the race and says live timing or results", () => {
  const live = sessionEmbed({ session, race: race() } as SessionInfo);
  assert.equal(live.title, "Test Race · Practice 1");
  assert.equal(live.description, "Live timing for Practice 1 of Test Race.");
  assert.equal(live.image, "timing");
  const ended = sessionEmbed({ session, race: race({ ended: true }) } as SessionInfo);
  assert.equal(ended.description, "Results for Practice 1 of Test Race.");
  assert.equal(ended.image, "results");
  assert.equal(raceEmbed(race({ ended: true })).image, "results");
});

test("tags use absolute image URLs and escape user text", () => {
  const tags = embedTags({ title: 'A "B" <i>', description: "x & y", image: "timing" }, "https://rsma.example", "/session/s1");
  assert.match(tags, /property="og:image" content="https:\/\/rsma\.example\/brand\/embed\/timing\.png"/);
  assert.match(tags, /name="twitter:card" content="summary_large_image"/);
  assert.match(tags, /content="A &quot;B&quot; &lt;i&gt;"/);
  assert.match(tags, /content="x &amp; y"/);
  assert.match(tags, /name="theme-color" content="#0031a7"/);
  assert.doesNotMatch(tags, /<i>/);
});

test("the site-wide card has no description tag", () => {
  assert.doesNotMatch(embedTags(DEFAULT_EMBED, "https://rsma.example", "/admin"), /description/);
});
