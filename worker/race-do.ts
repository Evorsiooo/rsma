import { DurableObject } from "cloudflare:workers";
import { EMPTY_STATE, type RaceState } from "../shared/race";

/** One instance per race. Source of truth for live state; pushes it to every connected socket. */
export class RaceDO extends DurableObject {
  private state: RaceState | null = null;

  private async load(): Promise<RaceState> {
    if (!this.state) this.state = (await this.ctx.storage.get<RaceState>("state")) ?? structuredClone(EMPTY_STATE);
    return this.state;
  }

  private async save(next: RaceState) {
    this.state = next;
    await this.ctx.storage.put("state", next);
    const msg = JSON.stringify(next);
    for (const ws of this.ctx.getWebSockets()) ws.send(msg);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify(await this.load()));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/state" && req.method === "GET") return Response.json(await this.load());
    if (url.pathname === "/state" && req.method === "PUT") {
      await this.save((await req.json()) as RaceState);
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  // Clients only receive; ignore anything they send.
  webSocketMessage() {}
}
