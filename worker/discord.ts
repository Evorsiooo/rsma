export const DISCORD_WEBHOOK_KEY = "discord_webhook";
export const DISCORD_EMOJI_HEADER = "## <:RSMA:1559243161744973966> | ";

export function formatDiscordStewardMessage(text: string): string {
  return `${DISCORD_EMOJI_HEADER}${text}`;
}

export async function getDiscordWebhook(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(DISCORD_WEBHOOK_KEY).first<{ value: string }>();
  return row?.value?.trim() || null;
}

export async function setDiscordWebhook(db: D1Database, url: string): Promise<void> {
  const clean = url.trim();
  if (clean) {
    await db.prepare(
      "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
    ).bind(DISCORD_WEBHOOK_KEY, clean).run();
  } else {
    await db.prepare("DELETE FROM settings WHERE key = ?").bind(DISCORD_WEBHOOK_KEY).run();
  }
}

export async function sendDiscordWebhook(url: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return res.ok;
  } catch (err) {
    console.error("Discord webhook delivery failed:", err);
    return false;
  }
}

export async function notifyStewardMessage(db: D1Database, text: string): Promise<void> {
  const url = await getDiscordWebhook(db);
  if (!url) return;
  await sendDiscordWebhook(url, formatDiscordStewardMessage(text));
}
