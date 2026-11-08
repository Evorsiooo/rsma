import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISCORD_EMOJI_HEADER,
  formatDiscordStewardMessage,
  getDiscordWebhook,
  setDiscordWebhook,
  sendDiscordWebhook,
  notifyStewardMessage,
} from "../worker/discord.ts";

function createMockDb() {
  const store = new Map<string, string>();
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes("SELECT value FROM settings WHERE key")) {
                const key = String(args[0]);
                const val = store.get(key);
                return val !== undefined ? ({ value: val } as T) : null;
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO settings")) {
                store.set(String(args[0]), String(args[1]));
              } else if (sql.includes("DELETE FROM settings")) {
                store.delete(String(args[0]));
              }
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

test("formatDiscordStewardMessage formats with the RSMA emoji header", () => {
  const msg = "Track is clear, pit lane open.";
  const formatted = formatDiscordStewardMessage(msg);
  assert.equal(formatted, `## <:RSMA:1559243161744973966> | ${msg}`);
  assert.equal(DISCORD_EMOJI_HEADER, "## <:RSMA:1559243161744973966> | ");
});

test("getDiscordWebhook and setDiscordWebhook manage settings table", async () => {
  const db = createMockDb();

  // Initially empty
  assert.equal(await getDiscordWebhook(db), null);

  // Set webhook URL with extra whitespace
  await setDiscordWebhook(db, "  https://discord.com/api/webhooks/123/abc  ");
  assert.equal(await getDiscordWebhook(db), "https://discord.com/api/webhooks/123/abc");

  // Overwrite webhook URL
  await setDiscordWebhook(db, "https://discord.com/api/webhooks/456/def");
  assert.equal(await getDiscordWebhook(db), "https://discord.com/api/webhooks/456/def");

  // Clear webhook URL with empty string
  await setDiscordWebhook(db, "   ");
  assert.equal(await getDiscordWebhook(db), null);
});

test("sendDiscordWebhook sends POST with json body", async () => {
  let calledUrl = "";
  let calledOptions: RequestInit | undefined;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input);
    calledOptions = init;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const ok = await sendDiscordWebhook("https://discord.example/webhook", "test content");
    assert.equal(ok, true);
    assert.equal(calledUrl, "https://discord.example/webhook");
    assert.equal(calledOptions?.method, "POST");
    assert.deepEqual(calledOptions?.headers, { "Content-Type": "application/json" });
    assert.equal(calledOptions?.body, JSON.stringify({ content: "test content" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notifyStewardMessage only sends when webhook is set", async () => {
  const db = createMockDb();
  let calls = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    // When no webhook is set, notify does nothing
    await notifyStewardMessage(db, "Hello world");
    assert.equal(calls, 0);

    // When webhook is configured, notify sends the message formatted
    await setDiscordWebhook(db, "https://discord.example/webhook");
    await notifyStewardMessage(db, "Green flag in 2 minutes");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
