import type { Env } from "../index";

function getBearer(request: Request) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.substring(7);
}

export async function validateAdmin(request: Request, env: Env): Promise<boolean> {
  const token = getBearer(request);
  if (!token) return false;
  if (token === env.MASTER_ADMIN_TOKEN) return true;

  const stmt = env.DB.prepare("SELECT role FROM tokens WHERE token = ?").bind(token);
  const result = await stmt.first<{ role: string }>();
  return result?.role === "ADMIN";
}

export async function validateAnyToken(request: Request, env: Env): Promise<boolean> {
  const token = getBearer(request);
  if (!token) return false;
  if (token === env.MASTER_ADMIN_TOKEN) return true;

  const stmt = env.DB.prepare("SELECT role FROM tokens WHERE token = ?").bind(token);
  const result = await stmt.first<{ role: string }>();
  return !!result;
}

export async function handleAuthApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Check auth
  if (!await validateAdmin(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (url.pathname === "/api/tokens/create" && request.method === "POST") {
    try {
      const { role } = await request.json() as any;
      if (role !== "ADMIN" && role !== "RACE_CONTROL") {
        return new Response("Invalid role", { status: 400 });
      }

      const id = crypto.randomUUID();
      const token = "rsma_" + crypto.randomUUID().replace(/-/g, "");
      const createdAt = Date.now();

      await env.DB.prepare(
        "INSERT INTO tokens (id, token, role, created_at) VALUES (?, ?, ?, ?)"
      ).bind(id, token, role, createdAt).run();

      return new Response(JSON.stringify({ id, token, role, created_at: createdAt }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  }

  if (url.pathname === "/api/tokens/list" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM tokens ORDER BY created_at DESC").all();
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (url.pathname.startsWith("/api/tokens/revoke/") && request.method === "DELETE") {
    const id = url.pathname.split("/").pop();
    await env.DB.prepare("DELETE FROM tokens WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response("Not Found", { status: 404 });
}
