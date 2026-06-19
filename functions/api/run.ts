import { type FnContext, json, clampInt, sanitizeText } from './_lib';

/** POST /api/run — 送出一場結算（排行榜：撐到第幾波 + 賺多少） */
export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const name = sanitizeText(body.name, 12) || '玩家';
  const wave = clampInt(body.wave, 0, 100000);
  const money = clampInt(body.money, 0, 1_000_000_000);
  const won = body.won ? 1 : 0;
  const device = sanitizeText(body.deviceId, 64);
  try {
    await env.DB.prepare('INSERT INTO runs (device_id,name,wave,money,won,created_at) VALUES (?,?,?,?,?,?)')
      .bind(device, name, wave, money, won, Date.now())
      .run();
  } catch {
    return json({ error: 'db error' }, 500);
  }
  return json({ ok: true });
};
