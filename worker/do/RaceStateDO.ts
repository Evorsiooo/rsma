import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import { raceStore } from "./state";
import { TimingEngine } from "./engine";

export class RaceStateDO extends DurableObject {
  private sessions: WebSocket[] = [];

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    
    // Load state from DO storage into vanilla zustand
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<any>("state");
      if (stored) {
        raceStore.setState(stored);
      }
    });

    // Subscribe to state changes to persist and broadcast
    raceStore.subscribe((state) => {
      this.ctx.storage.put("state", state);
      this.broadcast({ type: "STATE_UPDATE", payload: state });
    });
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    // API Route for sensors
    if (url.pathname.startsWith("/api/sensors") && request.method === "POST") {
      try {
        const hits = await request.json() as any[];
        TimingEngine.processBatch(hits);
        return new Response("OK");
      } catch (e) {
        return new Response("Bad Request", { status: 400 });
      }
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    
    server.accept();
    this.sessions.push(server);

    // Send initial state
    server.send(JSON.stringify({ type: "INIT", payload: raceStore.getState() }));

    server.addEventListener("message", async (msg) => {
      try {
        const actionData = JSON.parse(msg.data as string);
        this.handleAction(actionData);
      } catch (err) {
        console.error("Error processing message:", err);
      }
    });

    server.addEventListener("close", () => {
      this.sessions = this.sessions.filter(s => s !== server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private handleAction(actionData: any) {
    if (actionData.type === "ACTION") {
      const actionName = actionData.action;
      const args = actionData.payload || [];
      const storeState = raceStore.getState() as any;
      if (typeof storeState[actionName] === "function") {
        storeState[actionName](...args);
      }
    } else if (actionData.type === "TTS_MESSAGE" || actionData.type === "START_SEQUENCE") {
      this.broadcast(actionData);
    }
  }

  private broadcast(msg: any) {
    const str = JSON.stringify(msg);
    this.sessions.forEach(s => {
      try {
        s.send(str);
      } catch (e) {
        // Ignored
      }
    });
  }
}

