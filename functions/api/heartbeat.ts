import { type FnContext, json, sanitizeText } from './_lib';

/** POST /api/heartbeat — 在首頁/遊戲中定期上報，標記此裝置在線 */
export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  try {
    const body = (await request.json().catch(() => ({}))) as { deviceId?: string };
    const id = sanitizeText(body.deviceId, 64);
    if (!id) return json({ ok: false }, 400);
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO presence (device_id, last_seen) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET last_seen = ?',
    )
      .bind(id, now, now)
      .run();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 500);
  }
};
