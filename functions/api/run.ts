import { type FnContext, json, clampInt, sanitizeText, clientIp, rateLimited } from './_lib';

// 與 config.ts 同步：第 30 波破關，沒有無限模式 → 波數不可能超過 30
const WIN_WAVE = 30;

/** POST /api/run — 送出一場結算（排行榜：撐到第幾波 + 賺多少） */
export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  // 同一 IP 每 4 秒最多送一場，擋腳本洗榜
  if (await rateLimited(env, `run:${clientIp(request)}`, 4000)) {
    return json({ ok: false, error: 'too fast' }, 429);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const name = sanitizeText(body.name, 12) || '玩家';
  const wave = clampInt(body.wave, 0, WIN_WAVE); // 不可能超過破關波數
  const money = clampInt(body.money, 0, 10_000_000);
  const won = body.won && wave >= WIN_WAVE ? 1 : 0; // 沒撐到 30 波卻宣稱通關 → 視為未通關
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
