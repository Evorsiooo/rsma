import { DurableObject } from "cloudflare:workers";
import { handleAuthApi } from "./api/auth";
import { RaceStateDO } from "./do/RaceStateDO";

export interface Env {
  DB: D1Database;
  RACE_STATE: DurableObjectNamespace;
  ASSETS: { fetch: typeof fetch };
  MASTER_ADMIN_TOKEN: string;
}

export { RaceStateDO };

// Main Worker entrypoint
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API Routing
    if (url.pathname.startsWith("/api/tokens")) {
      return handleAuthApi(request, env);
    }
    
    
    // Live WebSocket routing and Sensor data routing
    if (url.pathname.startsWith("/live") || url.pathname.startsWith("/api/sensors")) {
      const id = env.RACE_STATE.idFromName("global-race");
      const obj = env.RACE_STATE.get(id);
      return obj.fetch(request);
    }

    // Static Asset Serving (SPA Fallback)
    try {
      let response = await env.ASSETS.fetch(request);
      if (response.status === 404) {
        // Fallback to index.html for SPA
        const indexReq = new Request(new URL("/", request.url));
        return await env.ASSETS.fetch(indexReq);
      }
      return response;
    } catch (e) {
      return new Response("Not found", { status: 404 });
    }
  }
};


