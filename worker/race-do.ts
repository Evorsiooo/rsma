import { DurableObject } from "cloudflare:workers";
import { applyCommand, type Command } from "../shared/commands";
import { emptyState, publicView, viewFor, type RaceState, type Viewer } from "../shared/race";

/** One instance per race. Source of truth for live state; pushes it to every connected socket. */
export class RaceDO extends DurableObject {
  private state: RaceState | null = null;

  private async load(): Promise<RaceState> {
    if (!this.state) this.state = { ...emptyState(), ...(await this.ctx.storage.get<RaceState>("state")) };
    return this.state;
  }

  /** Each socket sees what its viewer may: staff everything, signed-in viewers their own radio, others none. */
  private frame(state: RaceState, viewer: Viewer) {
    return JSON.stringify({ state: viewFor(state, viewer), now: Date.now() });
  }

  /** Socket tags carry the viewer: "staff", "user:<name>", "team:<id>". */
  private viewerOf(tags: string[]): Viewer {
    return {
      staff: tags.includes("staff"),
      user: tags.find((t) => t.startsWith("user:"))?.slice(5),
      teams: tags.filter((t) => t.startsWith("team:")).map((t) => t.slice(5)),
    };
  }

  private broadcast(state: RaceState) {
    for (const ws of this.ctx.getWebSockets()) ws.send(this.frame(state, this.viewerOf(this.ctx.getTags(ws))));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      // The Worker sets this header only after checking the caller's role.
      const tags: string[] = [];
      if (req.headers.get("x-staff") === "1") tags.push("staff");
      const user = req.headers.get("x-user");
      if (user) tags.push(`user:${user.toLowerCase()}`);
      for (const t of (req.headers.get("x-teams") ?? "").split(",").filter(Boolean)) tags.push(`team:${t}`);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], tags);
      pair[1].send(this.frame(await this.load(), this.viewerOf(tags)));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/state" && req.method === "GET") {
      return Response.json({ state: publicView(await this.load()), now: Date.now() });
    }
    if (url.pathname === "/cmd" && req.method === "POST") {
      const { cmd, actor } = (await req.json()) as { cmd: Command; actor: string };
      const result = applyCommand(await this.load(), cmd, { now: Date.now(), actor, newId: () => crypto.randomUUID() });
      if ("error" in result) return Response.json(result, { status: 400 });
      this.state = result.state;
      await this.ctx.storage.put("state", result.state);
      this.broadcast(result.state);
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  // Clients only receive; commands go through the authenticated HTTP endpoint.
  webSocketMessage() {}
}
