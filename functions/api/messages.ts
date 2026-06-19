import { type FnContext, json, sanitizeText, clampInt, clientIp, rateLimited, isBadText } from './_lib';

interface MsgRow {
  id: number;
  name: string;
  text: string;
  created_at: number;
}

/** GET /api/messages — 最新 60 則留言（新到舊） */
export const onRequestGet = async ({ env }: FnContext): Promise<Response> => {
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, name, text, created_at FROM messages ORDER BY id DESC LIMIT 60',
    ).all<MsgRow>();
    return json(results.map((r) => ({ id: r.id, name: r.name, text: r.text, at: r.created_at })));
  } catch {
    return json({ error: 'db error' }, 500);
  }
};

/** POST /api/messages — 新增一則留言（限流 + 髒話過濾） */
export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  try {
    // 同一 IP 每 8 秒最多一則，擋洗版
    if (await rateLimited(env, `msg:${clientIp(request)}`, 8000)) {
      return json({ ok: false, error: 'too fast' }, 429);
    }
    const body = (await request.json().catch(() => ({}))) as { name?: string; text?: string; deviceId?: string };
    const name = sanitizeText(body.name, 12) || '匿名';
    const text = sanitizeText(body.text, 120);
    if (!text) return json({ ok: false, error: 'empty' }, 400);
    if (isBadText(text) || isBadText(name)) return json({ ok: false, error: 'blocked' }, 422);
    const device = sanitizeText(body.deviceId, 64);
    await env.DB.prepare('INSERT INTO messages (name, text, device_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(name, text, device, Date.now())
      .run();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 500);
  }
};

/** DELETE /api/messages — 版主刪除（需正確 key；未設定 ADMIN_KEY 則停用） */
export const onRequestDelete = async ({ request, env }: FnContext): Promise<Response> => {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: number; key?: string };
    if (!env.ADMIN_KEY) return json({ ok: false, error: 'disabled' }, 403);
    if (!body.key || body.key !== env.ADMIN_KEY) return json({ ok: false, error: 'forbidden' }, 403);
    const id = clampInt(body.id, 1, 2_000_000_000);
    await env.DB.prepare('DELETE FROM messages WHERE id=?').bind(id).run();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 500);
  }
};
