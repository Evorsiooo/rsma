import { DurableObject } from "cloudflare:workers";
import { applyCommand, type Command } from "../shared/commands";
import { emptyState, publicView, type RaceState } from "../shared/race";

/** One instance per race. Source of truth for live state; pushes it to every connected socket. */
export class RaceDO extends DurableObject {
  private state: RaceState | null = null;

  private async load(): Promise<RaceState> {
    if (!this.state) this.state = (await this.ctx.storage.get<RaceState>("state")) ?? emptyState();
    return this.state;
  }

  /** Staff sockets get the full state (including the audit log), everyone else the public view. */
  private frame(state: RaceState, staff: boolean) {
    return JSON.stringify({ state: staff ? state : publicView(state), now: Date.now() });
  }

  private broadcast(state: RaceState) {
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(this.frame(state, this.ctx.getTags(ws).includes("staff")));
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      // The Worker sets this header only after checking the caller's role.
      const staff = req.headers.get("x-staff") === "1";
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], staff ? ["staff"] : []);
      pair[1].send(this.frame(await this.load(), staff));
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
