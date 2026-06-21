import { type FnContext, json, clampInt, clientIp, rateLimited } from './_lib';

/** POST /api/totals — 累加全服統計增量（賺錢/殺牛/殺怪/場次） */
export const onRequestPost = async ({ request, env }: FnContext): Promise<Response> => {
  // 遊戲端每 4 秒回報一次；同 IP 每 2.5 秒最多一次，擋灌水迴圈
  if (await rateLimited(env, `tot:${clientIp(request)}`, 2500)) {
    return json({ ok: false, error: 'too fast' }, 429);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  /** 單次增量上限，避免灌水 */
  const money = clampInt(body.money, 0, 10_000_000);
  const cows = clampInt(body.cows, 0, 100000);
  const monsters = clampInt(body.monsters, 0, 100000);
  const runs = clampInt(body.runs, 0, 1);
  try {
    await env.DB.prepare(
      'UPDATE stats SET total_money=total_money+?, total_cows=total_cows+?, total_monsters=total_monsters+?, plays=plays+? WHERE id=1',
    )
      .bind(money, cows, monsters, runs)
      .run();
  } catch {
    return json({ error: 'db error' }, 500);
  }
  return json({ ok: true });
};

/** GET /api/totals — 全服累計統計 */
export const onRequestGet = async ({ env }: FnContext): Promise<Response> => {
  try {
    const s = await env.DB.prepare(
      'SELECT total_money,total_cows,total_monsters,plays,opens FROM stats WHERE id=1',
    ).first<{ total_money: number; total_cows: number; total_monsters: number; plays: number; opens: number }>();
    return json({
      money: s?.total_money ?? 0,
      cows: s?.total_cows ?? 0,
      monsters: s?.total_monsters ?? 0,
      runs: s?.plays ?? 0,
      opens: s?.opens ?? 0,
    });
  } catch {
    return json({ error: 'db error' }, 500);
  }
};
