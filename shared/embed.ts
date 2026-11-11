import type { RaceSummary, SessionInfo } from "./types";

/** Link preview (Discord, Twitter/X) for one page: what the Worker writes into the HTML head. */
export interface Embed {
  title: string;
  description: string;
  image: EmbedImage;
}

export type EmbedImage = "default" | "home" | "timing" | "results" | "driver" | "team" | "work" | "legal";

export const SITE_NAME = "RSMA";
export const THEME_COLOR = "#0031a7";

export const DEFAULT_EMBED: Embed = { title: "Ro-State Motorsport Association", description: "", image: "default" };

const STATIC: Record<string, Embed> = {
  "/": { title: "Ro-State Motorsport Association", description: "Live timing, results and registration for RSMA events.", image: "home" },
  "/driver-registration": {
    title: "Driver Registration",
    description: "Register as an independent driver for an RSMA session, or find a team to race for.",
    image: "driver",
  },
  "/team-registration": {
    title: "Team Registration",
    description: "Open a ticket in #contact-us on the RSMA Discord to register a team. It needs at least 2 drivers and its own Discord server.",
    image: "team",
  },
  "/work-at-rsma": {
    title: "Work at the RSMA",
    description: "Open positions in sporting, race direction and media. Apply with a ticket in #contact-us on the RSMA Discord.",
    image: "work",
  },
  "/terms": { title: "Terms of service", description: "Terms of use for RSMA and Flagman, the race timing and race control platform.", image: "legal" },
  "/privacy": { title: "Privacy policy", description: "What RSMA stores when you sign in with Roblox, and how to have it deleted.", image: "legal" },
};

/** What a path needs from the database. Pages behind sign-in, and every unknown path, get the site-wide card. */
export type EmbedRoute = { kind: "static"; embed: Embed } | { kind: "session"; id: string } | { kind: "race"; id: string };

export function routeOf(pathname: string): EmbedRoute {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const fixed = STATIC[path];
  if (fixed) return { kind: "static", embed: fixed };
  const s = path.match(/^\/session\/([^/]+)$/);
  if (s) return { kind: "session", id: decodeURIComponent(s[1]) };
  const r = path.match(/^\/race\/([^/]+)$/);
  if (r) return { kind: "race", id: decodeURIComponent(r[1]) };
  return { kind: "static", embed: DEFAULT_EMBED };
}

export function sessionEmbed(info: SessionInfo): Embed {
  const { session: s, race } = info;
  const title = `${race.name} · ${s.name}`;
  if (race.ended) return { title, description: `Results for ${s.name} of ${race.name}.`, image: "results" };
  if (s.type === "race") return { title, description: `Timing and results for ${s.name} of ${race.name}.`, image: "timing" };
  return { title, description: `Live timing for ${s.name} of ${race.name}.`, image: "timing" };
}

export function raceEmbed(race: RaceSummary): Embed {
  return race.ended
    ? { title: race.name, description: `Results for ${race.name}.`, image: "results" }
    : { title: race.name, description: `Live timing and results for ${race.name}.`, image: "timing" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The head tags for one embed. Every tag carries so a page can replace the defaults in index.html. */
export function embedTags(e: Embed, origin: string, pathname: string): string {
  const img = `${origin}/brand/embed/${e.image}.png`;
  const tags: [string, string][] = [
    ["og:type", "website"],
    ["og:site_name", SITE_NAME],
    ["og:title", e.title],
    ["og:url", origin + pathname],
    ["og:image", img],
    ["og:image:width", "1200"],
    ["og:image:height", "630"],
    ["twitter:card", "summary_large_image"],
    ["twitter:title", e.title],
    ["twitter:image", img],
  ];
  if (e.description) {
    tags.push(["og:description", e.description], ["twitter:description", e.description]);
  }
  const meta = tags.map(([k, v]) => `<meta ${k.startsWith("og:") ? "property" : "name"}="${k}" content="${esc(v)}">`);
  meta.push(`<meta name="theme-color" content="${THEME_COLOR}">`);
  if (e.description) meta.push(`<meta name="description" content="${esc(e.description)}">`);
  return meta.join("\n    ");
}
