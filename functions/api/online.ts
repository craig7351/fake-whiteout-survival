import { type FnContext, json } from './_lib';

/** GET /api/online — 近 90 秒在線人數（心跳間隔 60s） */
export const onRequestGet = async ({ env }: FnContext): Promise<Response> => {
  try {
    const now = Date.now();
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM presence WHERE last_seen > ?')
      .bind(now - 90000)
      .first<{ n: number }>();
    const n = row?.n ?? 0;
    /** 機會性清除過期列 */
    await env.DB.prepare('DELETE FROM presence WHERE last_seen < ?')
      .bind(now - 600000)
      .run();
    return json({ online: Math.max(1, n) });
  } catch {
    return json({ online: 1 });
  }
};
