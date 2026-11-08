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

  private activeRadioUsers(): string[] {
    const list = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      for (const t of this.ctx.getTags(ws)) {
        if (t.startsWith("radio:")) list.add(t.slice(6));
      }
    }
    return Array.from(list);
  }

  /** Each socket sees what its viewer may: staff everything, signed-in viewers their own radio, others none. */
  private frame(state: RaceState, viewer: Viewer) {
    const s = { ...state, onRadio: this.activeRadioUsers() };
    return JSON.stringify({ state: viewFor(s, viewer), now: Date.now() });
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
      const radio = req.headers.get("x-radio");
      if (radio) tags.push(`radio:${radio.toLowerCase()}`);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], tags);
      const state = await this.load();
      pair[1].send(this.frame(state, this.viewerOf(tags)));
      if (radio) this.broadcast(state);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/state" && req.method === "GET") {
      const tags: string[] = [];
      if (req.headers.get("x-staff") === "1") tags.push("staff");
      const user = req.headers.get("x-user");
      if (user) tags.push(`user:${user.toLowerCase()}`);
      for (const t of (req.headers.get("x-teams") ?? "").split(",").filter(Boolean)) tags.push(`team:${t}`);
      const s = { ...(await this.load()), onRadio: this.activeRadioUsers() };
      return Response.json({ state: viewFor(s, this.viewerOf(tags)), now: Date.now() });
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

  // Clients receive state updates; handle keep-alive ping to prevent idle connection drop.
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") {
      try {
        ws.send("pong");
      } catch {}
    }
  }

  webSocketClose(ws: WebSocket) {
    const tags = this.ctx.getTags(ws);
    if (tags.some((t) => t.startsWith("radio:"))) {
      this.load().then((s) => this.broadcast(s));
    }
  }
}
